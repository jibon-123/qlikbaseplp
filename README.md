# QlikBase – চালু করার ধাপ

## ১. ফোনে সার্ভার চালু (Termux)
```
pkg update && pkg install nodejs git cloudflared
git clone https://github.com/YOUR_USER/YOUR_REPO.git && cd YOUR_REPO
termux-wake-lock
ADMIN_PASS=আপনার_পাসওয়ার্ড node server.js
```
`ADMIN_PASS` না দিলে সার্ভার চালুর সময় Termux-এ "Admin password: ..." দেখাবে।
ডাটা `data.json`-এ, ফাইল `uploads/`-এ জমা হয় (ফোনের স্টোরেজ)।

## ২. পাবলিক লিংক (নতুন Termux সেশনে)
```
cloudflared tunnel --url http://localhost:3000
```
`https://xxxx.trycloudflare.com` পাবেন। এটাই **Server URL**।
কনসোল ওই লিংকেই খোলা যায়: `SERVER_URL/`   |   আপনার সাইট: `SERVER_URL/site/` (`public/` ফোল্ডার)

## ৩. কনসোলের সাথে যুক্ত
Project settings → Backend server → **Server URL** + **Admin password** → Connect & sync

## ৪. অ্যাপ থেকে ব্যবহার (Header: `x-api-key` = Add app-এ পাওয়া key)
| কাজ | রিকোয়েস্ট |
|---|---|
| ডাটা পড়া/লেখা | GET/PUT/PATCH/DELETE `/api/db/পাথ`, নতুন কী: POST |
| লাইভ ডাটা | GET `/api/stream/পাথ?key=KEY` (SSE) |
| ইমেইল সাইন-আপ/ইন | POST `/api/auth/signup`, `/api/auth/signin` {email,password} |
| ফোন OTP | POST `/api/auth/phone/send` {phone} → POST `/api/auth/phone/verify` {phone,code} |
| Facebook | POST `/api/auth/facebook` {accessToken} |
| টোকেন যাচাই | GET `/api/auth/me` (Authorization: Bearer টোকেন) |
| ফাইল | PUT `/api/storage/নাম`, GET `/api/storage`, ফাইল: `/files/PROJECT_ID/নাম` |
| নোটিফিকেশন | GET `/api/notify`, লাইভ: `/api/notify/stream?key=KEY` |

Sketchware-এ PATCH না থাকলে POST + `?_method=PATCH` ব্যবহার করুন।

## Messaging API key (কনসোল → Messaging)
- OneSignal: `APP_ID:REST_API_KEY`
- FCM: Firebase service-account JSON পুরোটা পেস্ট (অ্যাপকে `all` টপিকে সাবস্ক্রাইব করতে হবে)
- Custom: নিজের webhook URL
- SMS (ফোন OTP): Twilio হলে `ACCOUNT_SID:AUTH_TOKEN:FROM_NUMBER`; Custom SMS API হলে URL

## মনে রাখবেন
- ফোন ও Termux চালু না থাকলে সার্ভার বন্ধ। ফ্রি Cloudflare লিংক প্রতিবার বদলায়।
- ডাটাবেসে রুলস নেই: App key যার কাছে, সে পড়তে/লিখতে পারে।
