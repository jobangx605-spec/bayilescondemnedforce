# bayilescondemnedforce

Baileys modifikasi by jojo. Versi **2.2.1** menambah JID nomor, ID `3EB0`, anti-call lengkap, dan banner naga di atas jalur stabil 2.1.0. Tidak ada fitur lama yang dihapus.

## Yang baru

- **Anti-overhit.** Query IQ dibatasi (maks 3 sekaligus) dan query grup yang sama digabung, jadi bot tidak menembak server WhatsApp sampai putus.
- **Balasan tetap cepat.** Pesan reply, react, edit, delete, dan chat yang baru masuk lewat jalur prioritas. Broadcast/status menunggu di belakang.
- **Tidak ada yang dibuang diam-diam.** Antrian kirim tidak di-drop. Kalau socket sudah mati, `sendMessage` melempar error dan payload-nya ada di `sock.antiOverhit.drainFailed()`.
- **Pesan masuk tidak nyangkut.** Satu pesan rusak tidak menghentikan antrian offline. Kalau handler error, pesan tetap di-ack dan tetap di-emit supaya event berikutnya tidak hilang.
- **Cache metadata grup** 5 menit + lookup node lebih cepat, jadi balasan grup tidak nunggu IQ berulang.
- **Hint reconnect** di `connection.update`: `shouldReconnect` dan `reconnectDelayMs`. Jangan loop reconnect kalau session sudah logout.

Fitur kirim yang sudah ada tetap jalan: button, list, interactive, album, payment, product, event, poll result, group story, sticker pack, newsletter, AI icon, edit/delete.

Yang ditambah:

- `mentionAll` atau `mentions: ['@all']` di grup
- `externalAdReply` di pesan biasa
- `code`, `table`, `latex`, `richResponse`
- `sendStatusMention(content, jids)` — status + mention, sudah di-pace
- `updateCallPrivacy`, `updateMessagesPrivacy`, `updateDisableLinkPreviewsPrivacy`
- JID masuk dinormalkan ke `628xxx@s.whatsapp.net` kalau WhatsApp kirim `@lid`. LID asli tetap di `key.remoteJidLid` / `key.participantLid`. Case memakai `msg.sender` atau `msg.key.participant || msg.key.remoteJid`. Pesan ephemeral, view-once, dan caption dibuka dulu supaya teksnya kebaca. Tombol native flow ikut `buttonsResponseMessage.selectedButtonId`.
- ID pesan baru format `3EB0...` (prefix `Z4PH-` sudah diganti).
- Anti-call **nyala default**: tolak telepon pribadi dan grup, plus set privasi panggilan `none` saat konek. Matikan dengan `antiCall: false`.

## Pakai

```js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('condemnedforce-baileys')

const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({
  auth: state,
  // default sudah nyala. Matikan dengan antiOverhit: false
  antiOverhit: {
    replyGapMs: 30,
    normalGapMs: 260,
    bulkGapMs: 650
  },
  antiCall: false
})

sock.ev.on('creds.update', saveCreds)
sock.ev.on('connection.update', ({ connection, lastDisconnect, shouldReconnect, reconnectDelayMs }) => {
  if (connection !== 'close') return
  const code = lastDisconnect?.error?.output?.statusCode
  if (shouldReconnect === false || code === DisconnectReason.loggedOut) return
  setTimeout(start, reconnectDelayMs || 2000)
})

// balasan — jalur cepat, tidak nunggu antrian bulk
await sock.sendMessage(jid, { text: 'siap' }, { quoted: msg })

// sebut semua member grup
await sock.sendMessage(groupJid, { text: 'absen', mentionAll: true })

// bulk / status jangan disamakan kecepatannya dengan reply
await sock.sendMessage(jid, { text: 'promo' }, { priority: 'low' })

await sock.sendMessage(jid, {
  code: { language: 'js', content: 'console.log(1)' },
  text: 'contoh',
  ai: true
})
```

Kalau kirim gagal karena socket putus, jangan anggap pesannya hilang:

```js
const missed = sock.antiOverhit.drainFailed()
```

Panggil itu setelah socket baru `open`, lalu kirim ulang yang masih perlu.

## Config anti-overhit

| Field | Default | Fungsi |
| --- | --- | --- |
| `maxConcurrentQueries` | 3 | batas IQ yang jalan bareng |
| `replyGapMs` | 30 | jeda balasan setelah burst |
| `normalGapMs` | 260 | jeda pesan biasa |
| `bulkGapMs` | 650 | jeda broadcast/status |
| `burst` | 4 | balasan pertama dalam 2 detik tanpa jeda |
| `replyWindowMs` | 45000 | chat yang baru ngechat dianggap reply |
| `holdWhileOfflineMs` | 2500 | tahan kirim sebentar kalau socket baru putus, lalu error (tidak di-drop diam-diam) |

`sock.antiOverhit.stats()` dan `sock.queryLane.stats()` buat pantau antrian.
