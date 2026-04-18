import { writeGoalEvent, loadGoalEvents } from '../goalEvents';

const mockInsert = jest.fn().mockReturnValue({ error: null });
const mockSelect = jest.fn().mockReturnValue({
  data: [
    {
      id: 'e1',
      goal_id: 'g1',
      event_type: 'at_risk',
      trigger: 'sync',
      shortfall: 300,
      snapshot: { projectedSurplus: 200 },
      created_at: '2026-04-18T12:00:00Z',
    },
  ],
  error: null,
});

jest.mock('../../supabase/client', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: mockInsert,
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(() => mockSelect()),
          })),
        })),
      })),
    })),
  },
}));

beforeEach(() => jest.clearAllMocks());

test('writeGoalEvent calls supabase insert with correct shape', async () => {
  await writeGoalEvent({
    userId: 'u1',
    goalId: 'g1',
    eventType: 'at_risk',
    trigger: 'sync',
    shortfall: 300,
    snapshot: { projectedSurplus: 200 },
  });
  expect(mockInsert).toHaveBeenCalledWith({
    user_id: 'u1',
    goal_id: 'g1',
    event_type: 'at_risk',
    trigger: 'sync',
    shortfall: 300,
    snapshot: { projectedSurplus: 200 },
  });
});

test('writeGoalEvent throws when supabase returns error', async () => {
  mockInsert.mockReturnValueOnce({ error: { message: 'DB error' } });
  await expect(writeGoalEvent({
    userId: 'u1', goalId: 'g1', eventType: 'at_risk',
    trigger: 'sync', shortfall: 0, snapshot: {},
  })).rejects.toThrow('DB error');
});

test('loadGoalEvents returns mapped events', async () => {
  const events = await loadGoalEvents('g1');
  expect(events).toHaveLength(1);
  expect(events[0].eventType).toBe('at_risk');
  expect(events[0].shortfall).toBe(300);
  expect(events[0].createdAt).toBe('2026-04-18T12:00:00Z');
});
