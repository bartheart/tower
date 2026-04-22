import React from 'react';
import { render } from '@testing-library/react-native';
import { WellnessDetailSheet } from '../WellnessDetailSheet';
import { WellnessResult } from '../../hooks/useWellnessScore';

// react-native-svg is auto-mocked in this project's jest config
// Modal is rendered inline in test environment

const baseWellness: WellnessResult = {
  score: 72,
  history: [65, 68, 70, 71, 72, 71, 72],
  delta: 7,
  status: 'Good',
  statusColor: '#f59e0b',
  factors: [
    {
      categoryId: 'cat-1',
      name: 'Dining',
      color: '#ef4444',
      targetPct: 20,
      targetSpend: 800,
      actualSpend: 960,
      ratio: 1.2,
      catScore: 80,
      scoreDelta: -20,
    },
    {
      categoryId: 'cat-2',
      name: 'Housing',
      color: '#6366f1',
      targetPct: 30,
      targetSpend: 1200,
      actualSpend: 1000,
      ratio: 0.83,
      catScore: 100,
      scoreDelta: 0,
    },
  ],
};

describe('WellnessDetailSheet', () => {
  it('renders score and status when visible', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('72')).toBeTruthy();
    expect(getByText('Good')).toBeTruthy();
  });

  it('renders factor rows for each category', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('Dining')).toBeTruthy();
    expect(getByText('Housing')).toBeTruthy();
  });

  it('shows "on track" for catScore 100 category', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('on track')).toBeTruthy();
  });

  it('shows negative scoreDelta for over-budget category', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('-20 pts')).toBeTruthy();
  });

  it('shows empty state when factors is empty', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={{ ...baseWellness, factors: [] }}
        transactions={[]}
      />
    );
    expect(getByText(/Set budget allocations/)).toBeTruthy();
  });

  it('does not render content when not visible', () => {
    const { queryByText } = render(
      <WellnessDetailSheet
        visible={false}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    // Modal with visible=false renders nothing in test environment
    expect(queryByText('72')).toBeNull();
  });

  it('shows top transaction merchant for over-budget category', () => {
    const transactions = [
      { merchantName: 'Cheesecake Factory', categoryL1: 'Dining', categoryL2: null, amount: 89, pending: false },
      { merchantName: 'Uber Eats', categoryL1: 'Dining', categoryL2: null, amount: 34, pending: false },
    ] as any[];

    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={transactions}
      />
    );
    // Dining is over-budget (catScore 80) — should show top transaction
    expect(getByText(/Cheesecake Factory/)).toBeTruthy();
  });
});
