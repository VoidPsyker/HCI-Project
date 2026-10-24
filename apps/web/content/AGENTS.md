# Participant content

All participant-facing wording (consent, instructions, induction scripts, check-in and
questionnaire items, debrief) and media paths live here as JSON; components only render them.
`src/content.ts` is the typed loader. Keep item ids stable: they are stored in the dataset.
Changing the number of questionnaire items changes the expected-answer count in
`apps/server/src/qa.ts`. Usage is in docs/README.md.
