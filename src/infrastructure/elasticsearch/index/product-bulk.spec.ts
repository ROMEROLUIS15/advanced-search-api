import { summarizeBulkResponse } from './product-bulk';

function response(items: unknown[]): never {
  return { items } as never;
}

describe('summarizeBulkResponse', () => {
  it('counts everything as indexed when no item carries an error', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(response([{ index: { _id: '1' } }]), 1);

    // Assert
    expect(result).toEqual({ total: 1, indexed: 1, failed: 0, failures: [] });
  });

  it('reports a failure with the reason Elasticsearch gave', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(
      response([{ index: { _id: 'p-1', error: { type: 'mapper_parsing', reason: 'bad date' } } }]),
      1,
    );

    // Assert
    expect(result).toEqual({
      total: 1,
      indexed: 0,
      failed: 1,
      failures: [{ id: 'p-1', reason: 'bad date' }],
    });
  });

  it('falls back to the error type when no reason is given', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(
      response([{ index: { _id: 'p-1', error: { type: 'version_conflict' } } }]),
      1,
    );

    // Assert
    expect(result.failures[0].reason).toBe('version_conflict');
  });

  it('falls back again when the error carries neither reason nor type', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(response([{ index: { _id: 'p-1', error: {} } }]), 1);

    // Assert
    expect(result.failures[0].reason).toBe('unknown error');
  });

  it('names an unidentified document rather than dropping the failure', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(response([{ index: { error: { reason: 'no id' } } }]), 1);

    // Assert
    expect(result.failures[0].id).toBe('unknown');
  });

  it('reads a create operation as well as an index one', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(
      response([{ create: { _id: 'p-2', error: { reason: 'exists' } } }]),
      1,
    );

    // Assert
    expect(result.failures).toEqual([{ id: 'p-2', reason: 'exists' }]);
  });

  it('keeps the indexed count consistent across a mixed batch', () => {
    // Arrange & Act
    const result = summarizeBulkResponse(
      response([
        { index: { _id: '1' } },
        { index: { _id: '2', error: { reason: 'bad' } } },
        { create: { _id: '3' } },
      ]),
      3,
    );

    // Assert
    expect(result).toMatchObject({ total: 3, indexed: 2, failed: 1 });
  });
});
