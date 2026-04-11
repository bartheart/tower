import { buildSankeyData } from '../buildGraph';

const MOCK_TRANSACTIONS = [
  { merchantName: 'Whole Foods', categoryL1: 'Food and Drink', categoryL2: 'Groceries', amount: 120 },
  { merchantName: 'Trader Joes', categoryL1: 'Food and Drink', categoryL2: 'Groceries', amount: 80 },
  { merchantName: 'Chipotle', categoryL1: 'Food and Drink', categoryL2: 'Restaurants', amount: 45 },
  { merchantName: 'Shell', categoryL1: 'Transportation', categoryL2: 'Gas', amount: 60 },
  { merchantName: 'Direct Deposit', categoryL1: 'Income', categoryL2: 'Paycheck', amount: -5200 },
];

describe('buildSankeyData', () => {
  it('builds nodes and links from transaction list', () => {
    const { nodes, links } = buildSankeyData(MOCK_TRANSACTIONS as any, 5200);

    // Should have: Income, Food and Drink, Transportation, Groceries, Restaurants, Gas, Whole Foods, Trader Joes, Chipotle, Shell
    const nodeNames = nodes.map(n => n.name);
    expect(nodeNames).toContain('Income');
    expect(nodeNames).toContain('Food and Drink');
    expect(nodeNames).toContain('Groceries');
    expect(nodeNames).toContain('Whole Foods');
  });

  it('link values are correct aggregations', () => {
    const { links } = buildSankeyData(MOCK_TRANSACTIONS as any, 5200);

    const groceriesLink = links.find(l =>
      (l.source as any).name === 'Food and Drink' &&
      (l.target as any).name === 'Groceries'
    );
    expect(groceriesLink?.value).toBe(200); // 120 + 80
  });

  it('income node value equals provided income amount', () => {
    const { nodes } = buildSankeyData(MOCK_TRANSACTIONS as any, 5200);
    const incomeNode = nodes.find(n => n.name === 'Income');
    expect(incomeNode?.value).toBe(5200);
  });
});
