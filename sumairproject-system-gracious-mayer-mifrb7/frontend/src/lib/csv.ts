import type { SessionEvent, SessionRecord } from '../types'

/** RFC 4180 quoting: wrap in quotes and double any embedded quote. */
function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toRows(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

function isoDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isoTime(ts: number): string {
  return new Date(ts).toISOString()
}

/**
 * Share of break prompts the user acted on, or null when no break was due.
 *
 * This used to report 100% for a session with no prompts. A 36-minute session
 * on a 45-minute interval was then recorded as perfect compliance with a
 * request that was never made, and every such row inflated the averages. With
 * no prompts the ratio is undefined, and it is exported as an empty cell.
 */
export function complianceRate(session: SessionRecord): number | null {
  if (session.breaksPrompted === 0) return null
  return Math.round((session.breaksTaken / session.breaksPrompted) * 1000) / 10
}

/**
 * Share of observed sitting time spent in good posture. Null for sessions
 * recorded before this was tracked, and for sessions with no observed sitting.
 */
export function goodPosturePct(session: SessionRecord): number | null {
  if (typeof session.goodPostureSeconds !== 'number' || session.sittingSeconds <= 0) return null
  return Math.round((session.goodPostureSeconds / session.sittingSeconds) * 1000) / 10
}

/** A field added after some sessions were recorded: blank for those, never 0 or NaN. */
function ifRecorded(value: number | undefined): number | '' {
  return typeof value === 'number' ? value : ''
}

/**
 * One row per session, exactly the columns named in PRD 7.5 so the file drops
 * straight into the paper's Results section.
 */
export const SESSION_CSV_HEADER = [
  'participant_id',
  'age',
  'behavior_type',
  'preferred_activity',
  'date',
  'session_start',
  'session_duration_min',
  // Sitting time, not wall time, is what triggers a break prompt. With the
  // interval beside it, a session with no prompts explains itself.
  'sitting_min',
  'break_interval_min',
  'avg_posture_deviation_pct',
  'good_posture_pct',
  'posture_alerts_triggered',
  'breaks_prompted',
  'breaks_taken',
  'breaks_snoozed',
  'manual_breaks',
  'compliance_rate_pct',
  'mode',
]

export function sessionsToCsv(sessions: SessionRecord[]): string {
  const rows: unknown[][] = [SESSION_CSV_HEADER]
  for (const s of sessions) {
    rows.push([
      s.participantId,
      s.age ?? '',
      s.behaviorType ?? '',
      s.activityType ?? '',
      isoDate(s.startTime),
      isoTime(s.startTime),
      Math.round((s.durationSeconds / 60) * 10) / 10,
      Math.round((s.sittingSeconds / 60) * 10) / 10,
      ifRecorded(s.breakIntervalMin),
      Math.round(s.avgDeviationPct * 10) / 10,
      goodPosturePct(s) ?? '',
      s.postureAlerts,
      s.breaksPrompted,
      s.breaksTaken,
      s.breaksSnoozed,
      ifRecorded(s.manualBreaks),
      complianceRate(s) ?? '',
      s.mode,
    ])
  }
  return toRows(rows)
}

/**
 * Event-level export. The session CSV is the headline dataset; this one lets the
 * paper report within-session timing (e.g. time-to-correction after an alert).
 */
export function eventsToCsv(events: SessionEvent[], sessions: SessionRecord[]): string {
  const participantById = new Map(sessions.map((s) => [s.id, s.participantId]))
  const startById = new Map(sessions.map((s) => [s.id, s.startTime]))

  const rows: unknown[][] = [
    ['participant_id', 'session_id', 'event_type', 'timestamp', 'seconds_into_session', 'deviation_pct', 'duration_seconds'],
  ]
  for (const e of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const start = startById.get(e.sessionId)
    rows.push([
      participantById.get(e.sessionId) ?? '',
      e.sessionId,
      e.type,
      isoTime(e.timestamp),
      start ? Math.round((e.timestamp - start) / 1000) : '',
      e.deviationPct !== undefined ? Math.round(e.deviationPct * 10) / 10 : '',
      e.durationSeconds ?? '',
    ])
  }
  return toRows(rows)
}

export function downloadCsv(filename: string, contents: string): void {
  // Prefix a BOM so Excel opens the file as UTF-8 rather than mangling it.
  const blob = new Blob([`﻿${contents}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
