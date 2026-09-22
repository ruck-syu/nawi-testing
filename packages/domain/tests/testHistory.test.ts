import { describe, it, expect } from 'vitest';
import { matches } from '../src/testHistory.ts';

describe('test-history filter matches()', () => {
  const sampleRun = {
    id: 1,
    modelId: 1,
    modelName: 'NHB150',
    familyName: 'NHB',
    projectId: 1,
    taskNo: 'A530947',
    reportNo: 'DANAK-1911302',
    manufacturerName: 'Taiwan Scale Mfg. Co., Ltd.',
    testTypeCode: 'INTRINSIC',
    displayName: 'Initial Intrinsic Error',
    category: 'Weighing Performance',
    reportSheetRef: '1',
    status: 'complete',
    verdict: 'pass',
    operatorName: 'A. Nielsen',
    remarks: 'Complies with MPE',
  };

  it('matches when no filter criteria are provided', () => {
    expect(matches(sampleRun, {})).toBe(true);
  });

  it('filters by verdict', () => {
    expect(matches(sampleRun, { verdict: 'pass' })).toBe(true);
    expect(matches(sampleRun, { verdict: 'fail' })).toBe(false);
    expect(matches(sampleRun, { verdict: 'incomplete' })).toBe(false);
  });

  it('filters by test type code', () => {
    expect(matches(sampleRun, { testTypeCode: 'INTRINSIC' })).toBe(true);
    expect(matches(sampleRun, { testTypeCode: 'REP' })).toBe(false);
  });

  it('filters by project ID', () => {
    expect(matches(sampleRun, { projectId: '1' })).toBe(true);
    expect(matches(sampleRun, { projectId: '2' })).toBe(false);
  });

  it('searches across task number, report number, manufacturer, operator, and model', () => {
    expect(matches(sampleRun, { needle: 'A530947' })).toBe(true);
    expect(matches(sampleRun, { needle: 'DANAK' })).toBe(true);
    expect(matches(sampleRun, { needle: 'Taiwan Scale' })).toBe(true);
    expect(matches(sampleRun, { needle: 'NHB150' })).toBe(true);
    expect(matches(sampleRun, { needle: 'Nielsen' })).toBe(true);
    expect(matches(sampleRun, { needle: 'Intrinsic' })).toBe(true);
    expect(matches(sampleRun, { needle: 'NonExistentXYZ' })).toBe(false);
  });
});
