import React from 'react';
import { render } from '@testing-library/react-native';
import { BudgetTreemap } from '../BudgetTreemap';

const mockBuckets = [
  { id: '1', name: 'Housing', targetPct: 32, color: '#6366f1' },
  { id: '2', name: 'Food', targetPct: 24, color: '#22c55e' },
  { id: '3', name: 'Transport', targetPct: 15, color: '#f59e0b' },
];

describe('BudgetTreemap', () => {
  it('renders without crashing', () => {
    const { getByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    expect(getByTestId('budget-treemap')).toBeTruthy();
  });

  it('renders a tile for each bucket', () => {
    const { getAllByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    // One tile per bucket + 1 unallocated tile (100 - 71 = 29%)
    expect(getAllByTestId('treemap-tile')).toHaveLength(4);
  });

  it('renders no unallocated tile when fully allocated', () => {
    const fullBuckets = [
      { id: '1', name: 'A', targetPct: 60, color: '#6366f1' },
      { id: '2', name: 'B', targetPct: 40, color: '#22c55e' },
    ];
    const { getAllByTestId } = render(
      <BudgetTreemap
        buckets={fullBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    expect(getAllByTestId('treemap-tile')).toHaveLength(2);
  });

  it('calls onTilePress with bucket id when tile is pressed', () => {
    const onPress = jest.fn();
    const { getAllByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={onPress}
      />,
    );
    const tiles = getAllByTestId('treemap-tile');
    tiles[0].props.onPress();
    expect(onPress).toHaveBeenCalledWith(expect.any(String));
  });

  it('shows placeholder tile when all targetPcts are null/0', () => {
    const emptyBuckets = [
      { id: '1', name: 'Housing', targetPct: null, color: '#6366f1' },
    ];
    const { getByTestId } = render(
      <BudgetTreemap
        buckets={emptyBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    expect(getByTestId('treemap-placeholder')).toBeTruthy();
  });
});
