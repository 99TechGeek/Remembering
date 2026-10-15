# Remembering: a voice-first second brain

Tap the mic, say what's on your mind, and it gets filed. Later, search or just ask.

- **"I have to call mom tomorrow at 6"** becomes a **Task**, due tomorrow at 18:00
- **"I met Priya Sharma at the design meetup, she works at Figma, her birthday is 25th October"** becomes a **Person** with a birthday, and Home reminds you when it's close
- **"Dentist appointment on Monday at 10am"** becomes an **Event** in "Coming up this week"
- **"Idea: an app that waters my plants"** becomes an **Idea**
- **"The spare key is under the blue flower pot"** becomes a **Note**
- **"Need to send Priya the portfolio link"** becomes a Task, and it shows up on Priya's page

Everything is organised into:

| Section | What's in it |
|---|---|
| **Home** | Due today/overdue, this week's events, birthdays in the next 30 days, recent notes |
| **Tasks** | Open / Today / Upcoming / Done, with one-tap checkboxes |
| **People** | One page per person that collects every note about them, plus their birthday |
| **Notes** | Notes, ideas and events, filterable by tag (`#work`, `#health`, `#money`…) |
| **Search & Ask** | Instant search over everything. Ask "when is Priya's birthday?" by typing or by voice |

You can download everything as Markdown documents (`Second Brain.md`, `Tasks.md`, `People.md`) or as a JSON backup from **Settings**.

## Use it on your phone

It's a Progressive Web App: a website you can install like an app, which works offline.

1. Host it (see below) and open the URL on your phone.
2. **iPhone (Safari):** Share → *Add to Home Screen*. **Android (Chrome):** ⋮ → *Install app*.
3. Long-press the icon for a **Quick voice note** shortcut that opens straight into recording (Android).

Voice input uses the browser's built-in speech recognition: Chrome, Edge, Safari (iOS 14.5+) and Android all support it. Firefox doesn't, but you can still type notes there.

## Run it

It's plain HTML/CSS/JS with no build step.

```bash
npm start           # serves on http://localhost:8080
npm test            # unit tests for the organiser, dates, search and documents
```

Microphones only work on `https://` or `localhost`, so opening `index.html` as a file won't give you voice.

### Live app

It's published at **https://99techgeek.github.io/Remembering/** (GitHub Pages, from the `gh-pages` branch).
Every push to `main` or `claude/voice-notes-task-tracker-cl2302` runs the tests and republishes the app
(`.github/workflows/pages.yml`). Installed copies pick up the new version the next time they're opened.

### iPhone: one-tap capture

Shortcuts app → **+** → *Open URLs* → `https://99techgeek.github.io/Remembering/?capture=1`, name it
"Remember this". Then say "Hey Siri, Remember this", or put it on the Action button or Back Tap.
That opens in Safari, which keeps its own copy of your notes separate from the home-screen app, so use one or the other.

## Reminders

Tasks and events with a date get a reminder automatically: at the time you said, 30 minutes before an event,
or at 9:00 if you didn't say a time. Change or clear it on any note (tap it → *Remind me at*).

- **Turn them on:** Settings → *Turn on reminders*. On iPhone this only works in the Home Screen app (iOS 16.4+).
- **When it fires** you get a notification, plus an in-app alert with *Done*, *In 10 min* and *Open*.
- **The app icon badge** shows how many tasks are due today or overdue.
- **Limitation:** with no server, the app can only check reminders while it's open or recently used.
  iOS doesn't let a website wake itself up later. For anything you can't miss, tap
  **📅 Add to iPhone Calendar** on the note: the Calendar app then alerts you even if Remembering is closed.

## Smarter organising with Claude (optional)

Without any setup, notes are organised on your device by built-in rules: phrases like "I need to", "remind me", "met", "birthday", dates such as "next Friday" or "12th June", and topic keywords.

For messier speech, and for real questions ("what did I promise Rahul?", "what do I need to buy?"), paste a Claude API key in **Settings**:

- Each new note is re-filed by Claude (type, title, people, dates, birthday, tags).
- **Search & Ask** sends your question plus your notes (or the most relevant ~120 if you have a lot) and shows the answer along with the notes it came from.
- Model choice: Claude Opus 5.5 (default), Sonnet 5.5, or Haiku 5.5 (cheapest). Calls use low effort to stay fast and cheap.
- *Settings → Re-organise all notes* re-runs filing on everything.

Your key is stored only in this browser and sent only to `api.anthropic.com`. Since it lives in the browser, use a key with a spending limit, and keep this to your own devices.

## Privacy & your data

- Notes are stored **only on your device** (IndexedDB). There's no server and no account.
- Notes go to Anthropic only if you add an API key.
- Speech-to-text is done by your browser or OS (Chrome on Android/desktop uses Google's speech service, Safari uses Apple's).
- Browsers can clear site data, so **download a backup** from Settings now and then. Restoring merges the backup with what's already there.

## Security

- **No server, no accounts, no database to break into.** Notes live only on each person's device.
- **Claude API key** (optional) is stored only in that browser and sent only to `api.anthropic.com`.
  It isn't in the code, so other users of the app never use yours. Anthropic API keys are billed
  separately from a Claude.ai subscription.
- **Locked-down page:** a Content-Security-Policy lets the page run only its own code and talk only to
  itself and the Claude API. The Anthropic SDK is bundled in `js/vendor/` rather than loaded from a CDN.
- **Restored backups and Claude's answers are validated** (`sanitizeNote`) before they're saved or shown.
- **What to protect:** your phone (lock screen) and your GitHub account (turn on two-factor
  authentication), since whoever can push to this repo can change the app for everyone who uses it.

## Code map

```
index.html            app shell
css/style.css         styles (light + dark)
js/app.js             UI, views, voice capture, search/ask
js/organizer.js       rule-based classification and extraction (task/person/event/idea/note)
js/dates.js           "tomorrow", "next friday", "12th June", times, birthdays
js/search.js          local ranked full-text search
js/documents.js       people directory, birthdays, Markdown export
js/ai.js              optional Claude organising and Q&A
js/speech.js          Web Speech API wrapper
js/reminders.js       reminder times, due checks, badge count, calendar (.ics) files
js/db.js              IndexedDB storage and settings
js/vendor/            bundled Anthropic SDK (loaded only when an API key is set)
sw.js                 offline cache
tests/                node --test unit tests
```

## Ideas for later

- Sync across devices (e.g. a small backend or your own Google Drive/Dropbox)
- True background push notifications (needs a small server, e.g. a free Cloudflare Worker)
- Keep the original audio alongside the transcript
- Recurring tasks ("every Monday")
