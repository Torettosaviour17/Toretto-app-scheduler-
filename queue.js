import { DatabaseSync } from 'node:sqlite';
export function queue(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, channel TEXT, caption TEXT, media TEXT, due INTEGER, status TEXT DEFAULT 'queued', result TEXT); CREATE INDEX IF NOT EXISTS due_posts ON posts(status,due)");
  return {
    add({channels, caption, media='', at}) {
      const due=Date.parse(at);
      if (!Array.isArray(channels) || !channels.length || channels.some(x=>!['facebook','instagram','x'].includes(x))) throw Error('Select at least one supported channel');
      if (typeof caption!=='string' || !caption.trim() || caption.length>63000) throw Error('Enter a valid caption');
      if (!/(Z|[+-]\d\d:\d\d)$/.test(at) || !Number.isFinite(due) || due<=Date.now()) throw Error('Choose a future time with a time zone');
      if (media && !(typeof media==='string' && /^https:\/\//i.test(media))) throw Error('Use an HTTPS image URL');
      if (channels.includes('instagram') && !media) throw Error('Instagram needs a public image URL');
      if (channels.includes('x') && (media || [...caption].length>280)) throw Error('X currently supports text posts up to 280 characters here');
      db.exec('BEGIN IMMEDIATE');
      try {
        const insert=db.prepare('INSERT INTO posts(channel,caption,media,due) VALUES(?,?,?,?)');
        const ids=[...new Set(channels)].map(channel=>Number(insert.run(channel,caption,media,due).lastInsertRowid));
        db.exec('COMMIT'); return ids;
      } catch(e) {db.exec('ROLLBACK'); throw e;}
    },
    list:()=>db.prepare('SELECT * FROM posts ORDER BY due,id').all(),
    cancel:id=>db.prepare("UPDATE posts SET status='cancelled' WHERE id=? AND status='queued'").run(id).changes,
    claim:now=>db.prepare("UPDATE posts SET status='sending' WHERE id=(SELECT id FROM posts WHERE status='queued' AND due<=? ORDER BY due,id LIMIT 1) RETURNING *").get(now),
    finish:(id,status,result)=>db.prepare("UPDATE posts SET status=?,result=? WHERE id=? AND status='sending'").run(status,result,id),
    close:()=>db.close()
  };
}
