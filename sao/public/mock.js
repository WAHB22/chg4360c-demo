// Phase 1 mock data. Every task, deadline and result here is invented for the
// preview and holds no personal data (this repo is public). Phase 2 replaces it
// with live data read locally from memory.md and state.json.
const DAY = 86400000;
const NOW = Date.now();

const base = (o) => ({ queue: [], orders: [], memory: [], deadline: null, ...o });
export const entities = {};
const add = (o) => (entities[o.id] = base(o));

add({
  id: 'icon',
  kind: 'icon',
  name: 'ICON',
  title: 'Digital twin of Wahb',
  task: 'Merge bot reports into memory.md and plan the next loop',
  status: 'Idle, waiting for your orders',
  last: 'Mock brief drafted, 5 items',
  memory: ['Mock line. Phase 2 shows the real memory.md here.'],
  queue: [{ id: 'q-icon-1', type: 'question', text: 'Mock question: which project comes first this week?' }],
});

add({
  id: 'ground',
  kind: 'island',
  name: 'SAO island',
  title: 'The world itself',
  task: 'Hold the plaza, campus and every site',
  status: '11 buildings, 5 bots, 3 running',
  last: 'World shell built with mock data',
  memory: ['Throttle: 3 bots run at once. Extra bots wait in line.'],
});

add({
  id: 'campus',
  kind: 'district',
  name: 'Campus',
  title: 'Six course dorms',
  task: 'Keep the six course dorms on track',
  status: 'Normal',
  last: 'Mock deadline sweep done',
  memory: ['Each dorm is one course. Windows glow brighter as its deadline gets closer.'],
});

// [id, name, mock days until the next deadline]
const DORMS = [
  ['chg3127', 'CHG 3127', 2],
  ['chg3337', 'CHG 3337', 9],
  ['chg3735', 'CHG 3735', 20],
  ['chg4360', 'CHG 4360', 5],
  ['chm2120', 'CHM 2120', 14],
  ['gng4120', 'GNG 4120', 4],
];
for (const [id, name, days] of DORMS) {
  add({
    id,
    kind: 'dorm',
    name,
    title: 'Course dorm',
    task: 'Prepare the next mock deliverable',
    status: days <= 3 ? 'Deadline close' : 'On track',
    last: 'Mock outline ready',
    deadline: NOW + days * DAY,
    deadlineLabel: 'Mock deliverable',
    memory: [`${name}: course notes will live here.`],
  });
}
entities.gng4120.inside = 'Class project lives inside this dorm';

add({
  id: 'internship',
  kind: 'building',
  name: 'Internship search',
  title: 'Next to campus',
  task: 'Mock: shortlist postings',
  status: 'Researching',
  last: 'Mock shortlist drafted',
  queue: [{ id: 'q-int-1', type: 'approval', text: 'Mock: send a message to a recruiter (touches the outside world)' }],
});

add({
  id: 'port',
  kind: 'building',
  name: 'Port',
  title: 'Empty dock',
  task: 'To be defined',
  status: 'Empty, waiting for a purpose',
  last: 'Nothing yet',
});

add({
  id: 'trailer',
  kind: 'building',
  name: 'Trailer',
  title: 'Trailer project',
  task: 'Mock: prepare the pitch slides',
  status: 'Blocked',
  last: 'Mock outline started',
});

add({
  id: 'social',
  kind: 'building',
  name: 'Social media',
  title: 'Pages and posts',
  task: 'Mock: draft post ideas',
  status: 'Draft ready, waiting for approval',
  last: 'Mock drafts written',
  queue: [{ id: 'q-soc-1', type: 'approval', text: 'Mock: publish a post (touches the outside world)' }],
});

add({
  id: 'spitch',
  kind: 'building',
  name: 'Spitch',
  title: 'Lowest priority',
  task: 'Hold until higher work finishes',
  status: 'Paused, lowest priority',
  last: 'Nothing new',
});

// [id, role, state, home, task, status]
const BOTS = [
  ['bot-researcher', 'researcher', 'working', 'internship', 'Mock: rank new postings', 'Running'],
  ['bot-drafter', 'drafter', 'working', 'chg4360', 'Mock: draft an outline', 'Running'],
  ['bot-tracker', 'tracker', 'blocked', 'campus', 'Mock: track course deadlines', 'Blocked: some dates not posted yet'],
  ['bot-planner', 'planner', 'waiting', 'port', 'Mock: shape a purpose for the port', 'Waiting on you: what is the port for?'],
  ['bot-scout', 'scout', 'working', 'icon', 'Weekly scout of AI progress that could upgrade SAO', 'Running'],
];
for (const [id, role, state, home, task, status] of BOTS) {
  add({
    id,
    kind: 'bot',
    name: role,
    title: `${role} bot`,
    role,
    runner: 'Claude Code subagent',
    state,
    home,
    task,
    status,
    last: 'Mock report sent to ICON',
  });
}
