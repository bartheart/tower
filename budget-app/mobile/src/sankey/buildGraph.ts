import Transaction from '../db/models/Transaction';

export interface SankeyNode {
  name: string;
  value?: number;
}

export interface SankeyLink {
  source: number | SankeyNode;
  target: number | SankeyNode;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export function buildSankeyData(
  transactions: Pick<Transaction, 'merchantName' | 'categoryL1' | 'categoryL2' | 'amount'>[],
  incomeAmount: number
): SankeyData {
  const nodeIndex = new Map<string, number>();
  const nodes: SankeyNode[] = [];
  const linkMap = new Map<string, number>(); // "source->target" => total amount

  function getOrAddNode(name: string): number {
    if (!nodeIndex.has(name)) {
      nodeIndex.set(name, nodes.length);
      nodes.push({ name });
    }
    return nodeIndex.get(name)!;
  }

  function addLink(source: string, target: string, amount: number) {
    const key = `${source}||${target}`;
    linkMap.set(key, (linkMap.get(key) ?? 0) + amount);
  }

  // Income node
  getOrAddNode('Income');
  nodes[0].value = incomeAmount;

  // Filter out income/transfer transactions (negative amounts = money in)
  const spending = transactions.filter(
    t => t.amount > 0 && t.categoryL1 !== 'Income' && !t.categoryL1.includes('Transfer')
  );

  for (const txn of spending) {
    const cat1 = txn.categoryL1 || 'Other';
    const cat2 = txn.categoryL2 || cat1;
    const merchant = txn.merchantName || 'Unknown';

    // Income → Category L1
    addLink('Income', cat1, txn.amount);
    // Category L1 → Category L2 (skip if same)
    if (cat2 !== cat1) addLink(cat1, cat2, txn.amount);
    // Category L2 → Merchant
    addLink(cat2 !== cat1 ? cat2 : cat1, merchant, txn.amount);

    getOrAddNode(cat1);
    if (cat2 !== cat1) getOrAddNode(cat2);
    getOrAddNode(merchant);
  }

  // Resolve links to node objects (required by d3-sankey and test assertions)
  const links: SankeyLink[] = [];
  for (const [key, value] of linkMap.entries()) {
    const [sourceName, targetName] = key.split('||');
    links.push({
      source: nodes[nodeIndex.get(sourceName)!],
      target: nodes[nodeIndex.get(targetName)!],
      value,
    });
  }

  return { nodes, links };
}
