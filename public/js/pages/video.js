// Single video page: player, owner controls (privacy, delete, send to coach), analysis, comments, report.
import { h, clear, loading, errorState, friendlyError, fmtDate, busy, toast, confirmDialog, modal, STATUS } from '../ui.js';
import { sb, state, q, rpc, action, sportName, isAdmin, mediaUrl, coverUrl, uploadFile, discardUpload } from '../api.js';
import { personLink, coverPicker } from '../images.js';
import { protectedVideo, analysisItem } from '../components.js';
import { go } from '../app.js';

export async function videoPage({ main, setTitle, params, query }) {
  setTitle('Video');
  const id = params[0];

  async function load() {
    clear(main).append(loading());
    let v;
    try {
      v = await q(sb.from('videos').select('*, owner:profiles!videos_owner_id_fkey(id,first_name,last_name,username,avatar_key)').eq('id', id).maybeSingle());
    } catch (e) { return clear(main).append(errorState(friendlyError(e), load)); }
    if (!v) return clear(main).append(errorState('Video not found, or it is private and you do not have access.'));
    const mine = v.owner_id === state.user.id;
    clear(main);

    main.append(
      h('div', { class: 'row between' }, personLink(v.owner),
        h('div', { class: 'row' }, v.is_sample && h('span', { class: 'tag' }, 'Sample'),
          h('span', { class: 'tag soft' }, v.visibility === 'public' ? 'Public' : 'Private'),
          v.removed && h('span', { class: 'tag fill' }, 'Removed by admin'))),
      h('h1', null, v.title),
      h('p', { class: 'meta' }, sportName(v.sport_id) + ' · ' + fmtDate(v.created_at)),
      protectedVideo('video', v.id, { tools: true, cover: v.cover_key }),
      v.description && h('p', { class: 'pre', style: { marginTop: '.75rem' } }, v.description));

    if (mine) main.append(ownerControls(v));

    // Requests & analyses on this video
    const reqBox = h('div');
    main.append(reqBox);
    try {
      const reqs = await q(sb.from('analysis_requests')
        .select('id,status,created_at,completed_at,trainee_id,coach_id,coach:profiles!analysis_requests_coach_id_fkey(first_name,last_name,username,avatar_key)')
        .eq('video_id', v.id).order('created_at', { ascending: false }));
      const visible = reqs.filter((r) => mine || r.coach_id === state.user.id || r.status === 'completed');
      if (visible.length) {
        reqBox.append(h('h2', { id: 'analysis' }, mine ? 'Requests & analyses' : 'Analysis'));
        for (const r of visible) {
          const card = h('div', { class: 'card' },
            h('div', { class: 'row between' },
              h('span', { class: 'row' }, 'Coach: ', personLink(r.coach, { size: 26, strong: false })),
              h('span', { class: 'tag' + (r.status === 'completed' ? ' fill' : '') }, STATUS[r.status])),
            (mine || r.coach_id === state.user.id) && h('a', { class: 'btn secondary small', style: { marginTop: '.5rem' }, href: '#/r/' + r.id }, 'Open full request'));
          if (r.status === 'completed') {
            const items = await q(sb.from('analysis_items').select('*').eq('request_id', r.id).order('created_at'));
            const order = { text: 0, video: 1, audio: 2 };
            items.sort((a, b) => order[a.kind] - order[b.kind]).forEach((it) => card.append(analysisItem(it)));
          }
          reqBox.append(card);
        }
        if (query.get('analysis') === '1') setTimeout(() => document.getElementById('analysis')?.scrollIntoView({ behavior: 'smooth' }), 300);
      }
    } catch (e) { reqBox.append(errorState(friendlyError(e))); }

    if (v.visibility === 'public' && !v.removed) {
      main.append(comments(v));
      if (!mine) main.append(h('div', { style: { marginTop: '1.5rem' } }, reportButton(v)));
    } else if (v.visibility === 'private') {
      main.append(h('p', { class: 'muted small', style: { marginTop: '1rem' } }, 'Comments are available on public videos only.'));
    }
    if (isAdmin() && !mine) main.append(adminControls(v));
  }

  function ownerControls(v) {
    const box = h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', { style: { marginTop: 0 } }, 'Manage video'));
    const pub = v.visibility === 'public';
    const toggle = h('button', { class: 'btn secondary block' }, pub ? 'Make private' : 'Make public');
    toggle.onclick = async () => {
      const ok = pub
        ? await confirmDialog('Make this video private?', 'The video and its analysis will be removed from the feed, your public profile and the coach\'s portfolio.', 'Make private')
        : await confirmDialog('Make this video public?', 'The video and its analysis will be visible in the feed and on your and the coach\'s profiles. Follow-up messages stay private.', 'Make public');
      if (!ok) return;
      busy(toggle, async () => {
        try { await q(sb.from('videos').update({ visibility: pub ? 'private' : 'public' }).eq('id', v.id)); toast(pub ? 'The video is now private' : 'The video is now public'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    const send = h('button', { class: 'btn secondary block' }, 'Send to a coach for analysis');
    send.onclick = async () => {
      const { sendExistingVideo } = await import('./upload.js');
      const rid = await sendExistingVideo(v);
      if (rid) { toast('Request sent to the coach'); go('/r/' + rid); }
    };
    const cover = h('button', { class: 'btn secondary block' }, 'Change cover image');
    cover.onclick = () => changeCover(v);
    const del = h('button', { class: 'btn secondary block' }, 'Delete video');
    del.onclick = async () => {
      if (!(await confirmDialog('Delete this video permanently?', 'The video and its requests and analyses will be deleted and cannot be recovered.', 'Delete permanently'))) return;
      busy(del, async () => {
        try { await action('delete_video', { p_video: v.id }); toast('Video deleted'); go('/me'); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    // A video whose file was removed to free space can only be deleted.
    box.append(h('div', { class: 'stack' }, ...(v.file_deleted_at ? [del] : [toggle, send, cover, del])));
    return box;
  }

  function adminControls(v) {
    const b = h('button', { class: 'btn secondary block' }, v.removed ? 'Restore content (admin)' : 'Remove problematic content (admin)');
    b.onclick = async () => {
      if (!(await confirmDialog(v.removed ? 'Restore this video?' : 'Remove this video from public view?', 'The owner will still see it.', 'OK'))) return;
      busy(b, async () => {
        try { await sb.rpc('admin_set_video_removed', { p_video: v.id, p_removed: !v.removed }).then(({ error }) => { if (error) throw error; }); toast('Updated'); load(); }
        catch (e) { toast(friendlyError(e), 'err'); }
      });
    };
    return h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h3', { style: { marginTop: 0 } }, 'Admin'), b);
  }

  function comments(v) {
    const box = h('section', { id: 'comments' }, h('h2', null, 'Comments'));
    const list = h('div', { class: 'stack' });
    const ta = h('textarea', { id: 'c_in', maxlength: 1000, style: { minHeight: '70px' }, placeholder: 'Write a comment…' });
    const send = h('button', { class: 'btn' }, 'Post comment');
    const loadC = async () => {
      clear(list).append(loading());
      try {
        const rows = await q(sb.from('comments').select('*, author:profiles(first_name,last_name,username,avatar_key)').eq('video_id', v.id).order('created_at'));
        clear(list);
        if (!rows.length) list.append(h('p', { class: 'muted' }, 'No comments yet.'));
        rows.forEach((c) => {
          const canDel = c.author_id === state.user.id || isAdmin();
          const del = canDel && h('button', { class: 'btn ghost small', onclick: async () => {
            if (!(await confirmDialog('Delete this comment?', null, 'Delete'))) return;
            try { await q(sb.from('comments').delete().eq('id', c.id)); loadC(); } catch (e) { toast(friendlyError(e), 'err'); }
          } }, 'Delete');
          list.append(h('div', { class: 'card' }, h('div', { class: 'row between' },
            personLink(c.author, { size: 28 }),
            h('span', { class: 'meta' }, fmtDate(c.created_at))), h('p', { class: 'pre' }, c.body), del));
        });
      } catch (e) { clear(list).append(errorState(friendlyError(e), loadC)); }
    };
    send.onclick = () => busy(send, async () => {
      if (!ta.value.trim()) return toast('The comment is empty', 'err');
      try { await q(sb.from('comments').insert({ video_id: v.id, author_id: state.user.id, body: ta.value.trim() })); ta.value = ''; loadC(); }
      catch (e) { toast(friendlyError(e), 'err'); }
    });
    box.append(list, h('div', { class: 'field', style: { marginTop: '.75rem' } }, h('label', { for: 'c_in' }, 'New comment'), ta), send);
    loadC();
    return box;
  }

  function reportButton(v) {
    const b = h('button', { class: 'btn ghost small' }, 'Report problematic content');
    b.onclick = async () => {
      const reason = await modal((close) => {
        const ta = h('textarea', { maxlength: 500, placeholder: 'What is wrong with this content?' });
        return [h('h2', null, 'Report content'), h('p', null, 'The report goes to the pilot admins.'), ta,
          h('div', { class: 'btn-row', style: { marginTop: '1rem' } },
            h('button', { class: 'btn', onclick: () => close(ta.value.trim() || 'No details') }, 'Send report'),
            h('button', { class: 'btn secondary', onclick: () => close(null) }, 'Cancel'))];
      });
      if (!reason) return;
      try { await q(sb.from('reports').insert({ video_id: v.id, reporter_id: state.user.id, reason })); toast('Thanks, the report was sent'); }
      catch (e) { toast(friendlyError(e), 'err'); }
    };
    return b;
  }

  // Owner picks a new cover: a frame from the video or a photo.
  async function changeCover(v) {
    let url;
    try { url = await mediaUrl('video', v.id); } catch (e) { return toast(friendlyError(e), 'err'); }
    const current = v.cover_key ? await coverUrl(v.cover_key) : null;
    const picker = coverPicker(url, { current });
    const saved = await modal((close) => {
      const save = h('button', { class: 'btn' }, 'Save cover');
      save.onclick = () => busy(save, async () => {
        if (!picker.chosen()) return toast('Pick a frame or upload a photo first', 'err');
        try {
          const blob = await picker.getBlob();
          const up = await uploadFile(new File([blob], 'cover.jpg', { type: 'image/jpeg' }), 'cover');
          let old;
          try { old = await rpc('set_video_cover', { p_video: v.id, p_key: up.key }); } catch (e) { discardUpload(up.key); throw e; }
          if (old) discardUpload(old);
          close(true);
        } catch (e) { toast(friendlyError(e), 'err'); }
      });
      return [h('h2', null, 'Cover image'), picker,
        h('div', { class: 'btn-row', style: { marginTop: '1rem' } }, save, h('button', { class: 'btn secondary', onclick: () => close(false) }, 'Cancel'))];
    });
    picker.cleanup();
    if (saved) { toast('Cover updated'); load(); }
  }

  await load();
}
