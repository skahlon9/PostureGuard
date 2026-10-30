import { describe, expect, it } from 'vitest'
import { SESSION_CSV_HEADER, complianceRate, goodPosturePct, sessionsToCsv } from './csv'
import type { SessionRecord } from '../types'

function session(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    participantId: 'P-ABC123',
    age: 16,
    behaviorType: 'student',
    activityType: 'studying',
    startTime: Date.UTC(2026, 8, 14, 10, 0, 0),
    endTime: Date.UTC(2026, 8, 14, 11, 0, 0),
    durationSeconds: 3600,
    mode: 'study',
    avgDeviationPct: 12.34,
    deviationSamples: 3400,
    postureAlerts: 3,
    breaksPrompted: 2,
    breaksTaken: 1,
    breaksSnoozed: 1,
    manualBreaks: 2,
    sittingSeconds: 3400,
    goodPostureSeconds: 2550,
    breakIntervalMin: 45,
    synced: false,
    ...patch,
  }
}

describe('goodPosturePct', () => {
  it('is the share of sitting time in good posture', () => {
    expect(goodPosturePct(session({ sittingSeconds: 1000, goodPostureSeconds: 250 }))).toBe(25)
  })

  it('is undefined when nobody was observed sitting', () => {
    expect(goodPosturePct(session({ sittingSeconds: 0, goodPostureSeconds: 0 }))).toBeNull()
  })
})

describe('complianceRate', () => {
  it('is the share of prompts the user actually acted on', () => {
    expect(complianceRate(session({ breaksPrompted: 4, breaksTaken: 3 }))).toBe(75)
  })

  it('is undefined, not 100%, when no break was ever due', () => {
    // Sep 29: a 36-minute session on a longer interval prompted nothing. It
    // used to be recorded as 100% compliant, inflating every average.
    expect(complianceRate(session({ breaksPrompted: 0, breaksTaken: 0 }))).toBeNull()
  })

  it('is not raised by breaks the user took by choice', () => {
    expect(complianceRate(session({ breaksPrompted: 2, breaksTaken: 1, manualBreaks: 5 }))).toBe(50)
  })
})

describe('sessionsToCsv', () => {
  it('emits the column set the pilot analysis expects', () => {
    const [header] = sessionsToCsv([session()]).split('\r\n')
    expect(header.split(',')).toEqual(SESSION_CSV_HEADER)
  })

  it('writes duration in minutes and rounds deviation to one decimal', () => {
    const row = sessionsToCsv([session()]).split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('session_duration_min')).toBe('60') // 3600s -> 60 min
    expect(col('avg_posture_deviation_pct')).toBe('12.3')
    expect(col('compliance_rate_pct')).toBe('50') // 1 of 2 breaks taken
  })

  it('quotes any field containing a comma so the row cannot split', () => {
    const csv = sessionsToCsv([session({ participantId: 'P-1,X' })])
    expect(csv).toContain('"P-1,X"')
    expect(csv.split('\r\n')[1].split(',').length).toBe(SESSION_CSV_HEADER.length + 1)
  })

  it('emits a header even with no sessions', () => {
    expect(sessionsToCsv([])).toBe(SESSION_CSV_HEADER.join(','))
  })

  it('writes an empty compliance cell when no break was due', () => {
    const row = sessionsToCsv([session({ breaksPrompted: 0, breaksTaken: 0 })]).split('\r\n')[1].split(',')
    expect(row[SESSION_CSV_HEADER.indexOf('compliance_rate_pct')]).toBe('')
  })

  it('exports sitting time and the interval, so a session with no prompts explains itself', () => {
    // 36 min on the clock, but only 30 of it sitting on a 45-minute interval:
    // no break was due, which is now visible in the row itself.
    const row = sessionsToCsv([
      session({ durationSeconds: 36 * 60, sittingSeconds: 30 * 60, breakIntervalMin: 45, breaksPrompted: 0 }),
    ]).split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('session_duration_min')).toBe('36')
    expect(col('sitting_min')).toBe('30')
    expect(col('break_interval_min')).toBe('45')
  })

  it('exports manual breaks and the good-posture share', () => {
    const row = sessionsToCsv([session()]).split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('manual_breaks')).toBe('2')
    expect(col('good_posture_pct')).toBe('75') // 2550 of 3400 sitting seconds
  })

  it('leaves new columns blank for sessions recorded before they existed', () => {
    // The first pilot days were recorded without these fields. They must read
    // as "not recorded", never as a fabricated 0 or as NaN.
    const legacy = session()
    delete (legacy as Partial<SessionRecord>).manualBreaks
    delete (legacy as Partial<SessionRecord>).goodPostureSeconds
    delete (legacy as Partial<SessionRecord>).breakIntervalMin

    const csv = sessionsToCsv([legacy])
    expect(csv).not.toContain('NaN')
    expect(csv).not.toContain('undefined')
    const row = csv.split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('manual_breaks')).toBe('')
    expect(col('good_posture_pct')).toBe('')
    expect(col('break_interval_min')).toBe('')
    expect(col('sitting_min')).toBe('56.7') // existed from the start
  })

  it('carries the profile so the dataset can be grouped without a second file', () => {
    const row = sessionsToCsv([session()]).split('\r\n')[1].split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('age')).toBe('16')
    expect(col('behavior_type')).toBe('student')
    expect(col('preferred_activity')).toBe('studying')
  })

  it('writes empty cells rather than "null" for an unset profile', () => {
    const row = sessionsToCsv([session({ age: null, behaviorType: null, activityType: null })])
      .split('\r\n')[1]
      .split(',')
    const col = (name: string) => row[SESSION_CSV_HEADER.indexOf(name)]
    expect(col('age')).toBe('')
    expect(col('behavior_type')).toBe('')
  })
})
