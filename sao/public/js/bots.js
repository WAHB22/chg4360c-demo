// ICON and the 7 core bots (World Bible, Part 8 B). Colors are the UI bot tokens.
// Helpers are smaller, simpler versions of their core bot: same color, tiny prop,
// no crest, tuft, ears or tail. At most 3 bots are active at once; the rest nap
// on the plaza bench in ICON's town.

export const ICON = {
  id: 'icon',
  name: 'ICON',
  look: 'Slightly taller than the bots. Simple rounded figure in a long cream traveler coat with gold trim, a leather satchel of scrolls, a small round compass emblem on the chest, simple calm dot eyes, no detailed face.',
  coat: '#F3EFE6',
  trim: '#E8C88E',
  satchel: '#8A5A3B',
  home: 'town',
};

export const CORE = [
  { id: 'scholar', name: 'Scholar', covers: 'school, study, finals', home: 'campus', color: '#8FB4E8', symbol: 'owl', prop: 'book', shape: 'round, with a small owl tuft', habit: 'reads while walking' },
  { id: 'scout', name: 'Scout', covers: 'internships, contacts', home: 'tower', color: '#E8C35A', symbol: 'falcon', prop: 'spyglass', shape: 'round, with a small falcon wing cape', habit: 'looks into the distance with the spyglass' },
  { id: 'baker', name: 'Baker', covers: 'Bobino, the trailer, the manager role', home: 'bobino', color: '#F0A9A3', symbol: 'bagel', prop: 'tray', shape: "round, with a baker's cap", habit: 'carries a tray, sniffs the air' },
  { id: 'keeper', name: 'Keeper', covers: 'home, food, gym, groceries', home: 'home', color: '#8FC79A', symbol: 'bear', prop: 'basket', shape: 'round and wide, with small bear ears', habit: 'waters plants, tidies' },
  { id: 'steward', name: 'Steward', covers: 'money, always local only', home: 'vault', color: '#A9AEB5', symbol: 'key', prop: 'ledger', shape: 'round, upright', habit: 'checks the lock twice' },
  { id: 'bard', name: 'Bard', covers: 'social media, the studio', home: 'lighthouse', color: '#C9A7E8', symbol: 'fox', prop: 'paintbrush', shape: 'round, with a fox tail', habit: 'sketches, hums, tail sways while thinking' },
  { id: 'herald', name: 'Herald', covers: 'social events, news, the morning brief', home: 'town', color: '#F2A35E', symbol: 'rooster', prop: 'horn', shape: 'round, with a small rooster crest', habit: 'stands on the well at 7:00 and announces' },
];

export const BOT = Object.fromEntries(CORE.map((b) => [b.id, b]));

// Visible states and their markers (color is never the only signal).
export const STATES = {
  working: { label: 'Working', marker: 'diamond' },
  traveling: { label: 'Travelling', marker: 'diamond' },
  waiting: { label: 'Waiting on you', marker: 'question' },
  sleeping: { label: 'Sleeping', marker: 'z' },
  done: { label: 'Done', marker: 'none' },
};

export const MAX_ACTIVE = 3;
