// A single analysis request: trainee view, coach analysis workspace, analysis result, follow-up messages.
import { h, clear, icon, loading, errorState, friendlyError, fmtDate, timeLeft, statusTag, DECLINE, POLICY, busy, toast, confirmDialog, confirmDanger, modal } from '../ui.js';
import { sb, state, q, rpc, action, sportName, languageNames, mediaUrl, coverUrl } from '../api.js';
import { protectedVideo, analysisItem, recorder, languagesLine } from '../components.js';
import { personLink, avatar, coverImg } from '../images.js';
import { coachViewer, readDrawings, isEmptyDrawings, analysisWatchCard } from '../viewer.js';
import { go, refreshBadge } from '../app.js';

export async function requestPage({ main, params }) {
  const id = params[0];
  let timers = [];
  let recorders = [];
  let closeViewer = null;
  let drawings = { strokes: [], notes: [] };   // the coach's pencil work and frame notes; kept while the page is open
  const cleanup = () => {
    timers.forEach(clearInterval); recorders.forEach((r) => r.cleanup && r.cleanup()); timers = []; recorders = [];
    closeViewer?.();
  };

  async function load() {
    cleanup();
    clear(main).append(loading());
    let r;
    try {
      r = await q(sb.from('analysis_requests')
        .select('*, video:videos(id,title,description,sport_id,visibility,owner_id,cover_key,file_deleted_at),' +
          'trainee:profiles!analysis_requests_trainee_id_fkey(id,first_name,last_name,username,avatar_key,languages),' +
          'coach:profiles!analysis_requests_coach_id_fkey(id,first_name,last_name,username,avatar_key,languages)')
        .eq('id', id).maybeSingle());
    } catch (e) { return clear(main).append(h('h1', null, 'Analysis request'), errorState(friendlyError(e), load)); }
    if (!r) return clear(main).append(h('h1', null, 'Analysis request'), errorState('Request not found, or you do not have access to it.'));

    const me = state.user.id;
    const isCoachHere = r.coach_id === me;
    const isTrainee = r.trainee_id === me;
    if ((isCoachHere && !r.coach_read) || (isTrainee && !r.trainee_read)) {
      rpc('mark_request_read', { p_request: id, p_read: true }).then(refreshBadge).catch(() => {});
    }
    const open = ['pending', 'draft'].includes(r.status) && new Date(r.deadline_at) > Date.now();

    clear(main);
    const deadlineEl = h('span', null, timeLeft(r.deadline_at));
    if (open) timers.push(setInterval(() => { deadlineEl.textContent = timeLeft(r.deadline_at); if (new Date(r.deadline_at) <= Date.now()) load(); }, 30000));

    main.append(
      h('a', { class: 'btn ghost small', href: '#/inbox' + (isCoachHere ? '?side=received' : '?side=sent') }, '← Back to inbox'),
      h('h1', null, r.video.title),
      h('div', { class: 'row' }, statusTag(r.status),
        h('span', { class: 'tag soft' }, r.video.visibility === 'public' ? 'Public' : 'Private')),
      h('div', { class: 'card', style: { margin: 'var(--space-3) 0' } }, h('div', { class: 'row between' },
        personBlock(r.trainee, 'Trainee'), personBlock(r.coach, 'Coach'))),
      r.status === 'declined' && h('div', { class: 'banner', role: 'status' }, h('strong', null, 'The request was declined. '), 'Reason: ' + (DECLINE[r.decline_reason] || '') + '. The video and request were kept.'),
      r.status === 'expired' && h('div', { class: 'banner', role: 'status' }, h('strong', null, 'Response time passed. '), 'The coach did not send an analysis by the deadline, so it can no longer be sent for this request. The video and request were kept.'),
      ['pending', 'draft'].includes(r.status) && !open && h('div', { class: 'banner' }, 'The response time has passed. The request will move to Not completed within a minute.'),
    );

    const left = h('div');
    const right = h('div');
    main.classList.add('wide');
    main.append(h('div', { class: 'two-col' }, left, right));
    // Request details at the bottom of the page.
    main.append(h('section', { class: 'request-details' }, h('h2', null, 'Request details'),
      h('dl', { class: 'kv' },
        h('dt', null, 'Sport'), h('dd', null, sportName(r.video.sport_id)),
        h('dt', null, 'Request sent'), h('dd', null, fmtDate(r.created_at)),
        r.completed_at
          ? [h('dt', null, 'Analysis sent'), h('dd', null, fmtDate(r.completed_at))]
          : [h('dt', null, 'Coach responds by'), h('dd', null, fmtDate(r.deadline_at), open ? [' · ', deadlineEl] : '')],
        h('dt', null, 'Follow-ups'), h('dd', null, POLICY[r.followup_policy]))));

    const coachWorks = isCoachHere && open;
    // A finished analysis replaces this placeholder with the full-screen card once its parts are loaded.
    const player = r.status === 'completed' && !r.video.file_deleted_at
      ? h('div', { class: 'player' }, h('div', { class: 'player-placeholder' }, h('div', { class: 'spinner' })))
      : protectedVideo('video', r.video.id, { autoplay: true, cover: r.video.cover_key });
    left.append(coachWorks ? viewerCard(r, right) : player,
      r.video.description && h('div', null, h('h3', null, 'Description'), h('p', { class: 'pre' }, r.video.description)),
      r.question && h('div', null, h('h3', null, 'Question for the coach'), h('p', { class: 'pre' }, r.question)));

    if (coachWorks) return workspace(r, right);
    if (r.status === 'completed') return result(r, right, isCoachHere, isTrainee, player);
    if (isTrainee && ['pending', 'draft'].includes(r.status)) {
      right.append(h('div', { class: 'state' }, h('p', null, h('strong', null, 'Waiting for the coach\'s analysis')),
        h('p', null, 'You\'ll get a notification when the analysis arrives. Deadline: ' + fmtDate(r.deadline_at) + '.')));
    }
  }

  // ---------- Coach: the video opens full screen; the response panel moves into the viewer's bottom sheet ----------
  function viewerCard(r, right) {
    return h('button', { type: 'button', class: 'viewer-card', onclick: () => openViewer(r, right) },
      coverImg(coverUrl(r.video.cover_key)),
      h('span', { class: 'viewer-card-play' }, icon('play')),
      h('span', { class: 'viewer-card-label' }, 'Watch full screen'));
  }
  async function openViewer(r, right) {
    if (closeViewer) return;
    let src;
    try { src = await mediaUrl('video', r.video.id); } catch (e) { return toast(friendlyError(e), 'err'); }
    if (closeViewer) return;
    const slot = h('div');
    right.replaceWith(slot);
    const viewer = coachViewer({
      src, title: r.video.title,
      onClose: () => closeViewer?.(),
      onAction: (kind) => focusResponse(right, kind),
      drawings, onDrawingsChange: (d) => { drawings = d; },
      onSave: () => rpc('save_drawings', { p_request: r.id, p_drawings: drawings }).catch((e) => toast(friendlyError(e), 'err')),
    });
    viewer.sheetBody.append(right);
    document.body.append(viewer.el);
    closeViewer = () => { closeViewer = null; viewer.destroy(); slot.replaceWith(right); };
  }
  function focusResponse(root, kind) {
    if (kind === 'write') return root.querySelector('#a_text')?.focus();
    root.querySelectorAll('.rec')[kind === 'voice' ? 0 : 1]?.scrollIntoView({ block: 'center' });
  }

  // ---------- Coach workspace ----------
  async function workspace(r, root) {
    let items = [];
    try { items = await q(sb.from('analysis_items').select('*').eq('request_id', r.id).order('created_at')); }
    catch (e) { return root.append(errorState(friendlyError(e), load)); }
    const textItem = items.find((i) => i.kind === 'text');
    const savedDrawings = items.find((i) => i.kind === 'drawing');
    if (savedDrawings && isEmptyDrawings(drawings)) drawings = readDrawings(savedDrawings.body);
    const text = h('textarea', { id: 'a_text', style: { minHeight: '180px' }, placeholder: 'What you saw, what to fix and how to practice' }, textItem?.body || '');
    text.value = textItem?.body || '';
    // Each recorder holds one attached clip (the first of its kind); older drafts may have more, listed here.
    const firstAudio = items.find((i) => i.kind === 'audio');
    const firstVideo = items.find((i) => i.kind === 'video');
    const inRecorder = new Set([firstAudio?.id, firstVideo?.id]);
    const mediaList = h('div');
    const renderMedia = () => {
      clear(mediaList);
      const media = items.filter((i) => (i.kind === 'audio' || i.kind === 'video') && !inRecorder.has(i.id));
      if (!media.length) return;
      mediaList.append(h('h3', null, 'More recordings in the analysis'));
      media.forEach((it) => {
        const del = h('button', { class: 'btn danger small' }, 'Remove');
        del.onclick = async () => {
          if (!(await confirmDanger('Remove this recording?', 'It will be deleted from the draft.', 'Remove'))) return;
          busy(del, async () => {
            try { await action('remove_analysis_item', { p_item: it.id }); items = items.filter((x) => x.id !== it.id); renderMedia(); toast('Recording removed'); }
            catch (e) { toast(friendlyError(e), 'err'); }
          });
        };
        mediaList.append(h('div', null, analysisItem(it, r.video.id), h('div', { style: { margin: 'var(--space-1) 0 var(--space-3)' } }, del)));
      });
    };
    renderMedia();

    const onSaved = (kind) => async ({ key, contentType }) => {
      const iid = await rpc('add_analysis_media', { p_request: r.id, p_kind: kind, p_storage_key: key, p_content_type: contentType });
      await rpc('save_draft', { p_request: r.id });
      const it = { id: iid, kind, storage_key: key, content_type: contentType };
      items.push(it);
      inRecorder.add(iid);
      return it;
    };
    const onRemove = async (it) => {
      try { await action('remove_analysis_item', { p_item: it.id }); }
      catch (e) { if (/EXPIRED|NOT_OPEN/.test(e.message)) load(); throw e; }
      items = items.filter((x) => x.id !== it.id);
      inRecorder.delete(it.id);
    };
    const audioRec = recorder('audio', { onSaved: onSaved('audio'), onRemove, item: firstAudio });
    const videoRec = recorder('video', { onSaved: onSaved('video'), onRemove, item: firstVideo });
    recorders.push(audioRec, videoRec);

    const saveBtn = h('button', { class: 'btn secondary' }, 'Save draft');
    const sendBtn = h('button', { class: 'btn' }, 'Send analysis');
    const cancelBtn = h('button', { class: 'btn danger', 'aria-label': 'Discard analysis work' }, '✕ Discard');
    const declineBtn = h('button', { class: 'btn danger' }, 'Can\'t analyze');

    saveBtn.onclick = () => busy(saveBtn, async () => {
      try {
        await rpc('set_analysis_text', { p_request: r.id, p_text: text.value });
        await rpc('save_drawings', { p_request: r.id, p_drawings: drawings });
        await rpc('save_draft', { p_request: r.id });
        toast('Draft saved. The request still takes a spot in your quota.');
      } catch (e) { toast(friendlyError(e), 'err'); if (/EXPIRED|NOT_OPEN/.test(e.message)) load(); }
    });
    sendBtn.onclick = async () => {
      const hasMedia = items.some((i) => i.kind !== 'text' && i.kind !== 'drawing');
      if (!text.value.trim() && !hasMedia) return toast('Add at least one part: text, a voice recording or a video recording.', 'err');
      if (!(await confirmDialog('Send the analysis to the trainee?', 'After sending, the analysis cannot be edited.', 'Send'))) return;
      busy(sendBtn, async () => {
        try {
          await rpc('set_analysis_text', { p_request: r.id, p_text: text.value });
          await rpc('save_drawings', { p_request: r.id, p_drawings: drawings });
          await rpc('send_analysis', { p_request: r.id });
          toast('Analysis sent to the trainee');
          load();
        } catch (e) { toast(friendlyError(e), 'err'); if (/EXPIRED|NOT_OPEN/.test(e.message)) load(); }
      });
    };
    cancelBtn.onclick = async () => {
      if (!(await confirmDanger('Discard your analysis work?', 'The text and recordings will be deleted and the request marked as unread. The trainee\'s request is not cancelled and the response time does not reset.', 'Discard'))) return;
      busy(cancelBtn, async () => {
        try { await action('discard_draft', { p_request: r.id }); toast('Analysis work discarded'); go('/inbox?side=received'); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    declineBtn.onclick = async () => {
      const reason = await modal((close) => {
        let pick = null;
        return [h('h2', null, 'Can\'t analyze'), h('p', null, 'Choose a reason. The trainee will see it.'),
          h('div', { class: 'choices' }, Object.entries(DECLINE).map(([k, l]) =>
            h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'dr', onchange: () => { pick = k; } }), h('span', { class: 't' }, l)))),
          h('div', { class: 'btn-row', style: { marginTop: 'var(--space-4)' } },
            h('button', { class: 'btn danger', onclick: () => (pick ? close(pick) : toast('Choose a reason', 'err')) }, 'Confirm decline'),
            h('button', { class: 'btn secondary', onclick: () => close(null) }, 'Back'))];
      });
      if (!reason) return;
      busy(declineBtn, async () => {
        try { await action('decline_request', { p_request: r.id, p_reason: reason }); toast('Request declined and moved to Not completed'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };

    root.append(
      h('h2', { style: { marginTop: 0 } }, 'Your analysis'),
      r.status === 'draft' && h('p', { class: 'tag soft' }, 'Draft saved'),
      (r.trainee.languages || []).length
        ? h('p', { class: 'banner' }, `${r.trainee.first_name} speaks: `, h('strong', null, languageNames(r.trainee.languages)))
        : null,
      h('p', { class: 'muted small' }, 'You can combine text, a voice recording and a video recording. At least one part is required.'),
      h('div', { class: 'field' }, h('label', { for: 'a_text' }, 'Text'), text),
      audioRec, h('div', { style: { height: 'var(--space-3)' } }), videoRec,
      mediaList,
      h('div', { class: 'card soon', style: { marginTop: 'var(--space-4)' } },
        h('div', { class: 'row' }, h('strong', null, 'Explainer recording'), h('span', { class: 'tag' }, 'Soon')),
        h('p', { class: 'small muted' }, 'A combined recording (trainee video + your voice + a small camera of you) is coming next. It is not active yet.')),
      h('div', { class: 'btn-row', style: { marginTop: 'var(--space-5)' } }, sendBtn, saveBtn),
      h('div', { class: 'btn-row', style: { marginTop: 'var(--space-2)' } }, declineBtn, cancelBtn));
  }

  // ---------- Completed: analysis + follow-ups ----------
  // The video opens full screen with the coach's drawings and frame texts (read only); the text and
  // recordings are listed here and also in the viewer's Analysis panel.
  async function result(r, root, isCoachHere, isTrainee, player) {
    root.append(h('h2', { style: { marginTop: 0 } }, 'Analysis from ' + r.coach.first_name + ' ' + r.coach.last_name));
    const itemsBox = h('div', null, loading());
    root.append(itemsBox);
    try {
      const order = { text: 0, video: 1, audio: 2 };
      const all = await q(sb.from('analysis_items').select('*').eq('request_id', r.id).order('created_at'));
      const drawingItem = all.find((it) => it.kind === 'drawing');
      const items = all.filter((it) => it.kind !== 'drawing').sort((a, b) => order[a.kind] - order[b.kind]);
      const parts = () => items.map((it) => analysisItem(it, r.video.id));
      if (!r.video.file_deleted_at) {
        player.replaceWith(analysisWatchCard(r.video, { drawings: drawingItem?.body, parts: h('div', { class: 'stack' }, parts()) }));
      }
      clear(itemsBox).append(
        drawingItem && !r.video.file_deleted_at && h('p', { class: 'muted small' }, 'Open the video to see the coach\'s drawings and notes at their moments.'),
        ...(items.length ? parts() : [h('p', { class: 'muted' }, 'No analysis parts.')]));
    } catch (e) {
      clear(itemsBox).append(errorState(friendlyError(e)));
      player.replaceWith(protectedVideo('video', r.video.id, { autoplay: true, cover: r.video.cover_key }));
    }

    if (!isCoachHere && !isTrainee) return;
    const thread = h('div', { class: 'thread' });
    const composer = h('div');
    const other = isCoachHere ? r.trainee : r.coach;
    root.append(h('h2', null, 'Follow-up messages'), h('p', { class: 'muted small' }, 'Chat rules: ' + POLICY[r.followup_policy] + ' (the coach\'s setting when the video was sent). Messages are private between you, even if the video is public.'),
      languagesLine(other.languages, `${other.first_name} speaks`), thread, composer);

    const loadThread = async () => {
      clear(thread).append(loading());
      try {
        const [msgs, st] = await Promise.all([
          q(sb.from('messages').select('*').eq('request_id', r.id).order('created_at')),
          rpc('followup_state', { p_request: r.id }),
        ]);
        clear(thread);
        if (!msgs.length) thread.append(h('p', { class: 'muted' }, 'No messages yet.'));
        msgs.forEach((m) => {
          const who = m.sender_id === r.coach_id ? r.coach : r.trainee;
          const mine = m.sender_id === state.user.id;
          thread.append(h('div', { class: 'msg-row ' + (mine ? 'mine' : 'theirs') }, !mine && avatar(who, 28),
            h('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') },
              h('div', null, m.body), h('div', { class: 'meta' }, (m.sender_id === r.coach_id ? 'Coach' : 'Trainee') + ' · ' + fmtDate(m.created_at))),
            mine && avatar(who, 28)));
        });
        renderComposer(st[0] || { can_send: false, reason: 'NOT_FOUND' });
      } catch (e) { clear(thread).append(errorState(friendlyError(e), loadThread)); }
    };
    const REASONS = {
      POLICY_NONE: 'This request has no follow-up messages. The analysis is available to watch.',
      ONE_USED: 'You sent your one follow-up message. The coach can reply to it.',
      ONE_REPLIED: 'You replied to the follow-up message. The conversation for this request has ended.',
      WAIT_TRAINEE: 'You can reply only if the trainee sends a follow-up message.',
      CHAT24_ENDED: 'The 24-hour chat window has ended.',
      ACCOUNT_DISABLED: 'The account is disabled.',
    };
    const HINTS = {
      ONE_TRAINEE: 'You can send only one follow-up message. Include everything that matters to you.',
      ONE_COACH_REPLY: 'You can reply once to the follow-up message.',
      CHAT24: 'The chat is open until ' + fmtDate(new Date(new Date(r.completed_at).getTime() + 864e5)) + '.',
      UNLIMITED: '',
    };
    function renderComposer(st) {
      clear(composer);
      if (!st.can_send) return composer.append(h('p', { class: 'banner' }, REASONS[st.reason] || 'You cannot send a message right now.'));
      const ta = h('textarea', { id: 'msg_in', maxlength: 4000, placeholder: 'Write a message…', style: { minHeight: '90px' } });
      const send = h('button', { class: 'btn' }, 'Send');
      send.onclick = () => busy(send, async () => {
        if (!ta.value.trim()) return toast('The message is empty', 'err');
        if (st.reason === 'ONE_TRAINEE' && !(await confirmDialog('Send the follow-up message?', 'This is the only message you can send for this request.', 'Send'))) return;
        try { await rpc('send_message', { p_request: r.id, p_body: ta.value }); toast('Message sent'); loadThread(); }
        catch (e) { toast(friendlyError(e), 'err'); loadThread(); }
      });
      composer.append(h('div', { class: 'field', style: { marginTop: 'var(--space-3)' } }, h('label', { for: 'msg_in' }, 'Message'), ta,
        HINTS[st.reason] && h('div', { class: 'hint' }, HINTS[st.reason])), send);
    }
    loadThread();
  }

  await load();
  return cleanup;
}

// Photo, name, role and spoken languages of one side of the request.
function personBlock(p, role) {
  return h('div', { class: 'stack', style: { minWidth: '45%' } },
    h('div', { class: 'meta' }, role),
    personLink(p, { size: 40 }),
    languagesLine(p.languages));
}
