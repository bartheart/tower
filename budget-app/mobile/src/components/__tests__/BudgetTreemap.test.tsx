import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BudgetTreemap, hexToRgba } from '../BudgetTreemap';

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
    const { getAllByTestId, getByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    // Simulate layout so containerWidth > 0 and tiles render
    fireEvent(getByTestId('budget-treemap'), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
    // One tile per bucket + 1 unallocated tile (100 - 71 = 29%)
    expect(getAllByTestId('treemap-tile')).toHaveLength(4);
  });

  it('renders no unallocated tile when fully allocated', () => {
    const fullBuckets = [
      { id: '1', name: 'A', targetPct: 60, color: '#6366f1' },
      { id: '2', name: 'B', targetPct: 40, color: '#22c55e' },
    ];
    const { getAllByTestId, getByTestId } = render(
      <BudgetTreemap
        buckets={fullBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    fireEvent(getByTestId('budget-treemap'), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
    expect(getAllByTestId('treemap-tile')).toHaveLength(2);
  });

  it('calls onTilePress with bucket id when tile is pressed', () => {
    const onPress = jest.fn();
    const { getAllByTestId, getByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={onPress}
      />,
    );
    fireEvent(getByTestId('budget-treemap'), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
    const tiles = getAllByTestId('treemap-tile');
    fireEvent.press(tiles[0]);
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

describe('hexToRgba', () => {
  it('converts 6-digit hex to rgba', () => {
    expect(hexToRgba('#6366f1', 0.5)).toBe('rgba(99,102,241,0.5)');
  });

  it('falls back for invalid hex', () => {
    expect(hexToRgba('invalid', 0.5)).toBe('rgba(100,100,100,0.5)');
  });
});
