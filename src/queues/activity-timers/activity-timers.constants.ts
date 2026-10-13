export const ACTIVITY_TIMERS_QUEUE = 'activity-timers';

export const ACTIVITY_SWEEP_SCHEDULER_ID = 'activity-timers-sweep';

export enum TimerKind {
  RESPONSE_TIMEOUT = 'response-timeout',
  START = 'start',
  END = 'end',
  SWEEP = 'sweep',
}

export interface ActivityTimerJobData {
  activityId: string;
  version: number;
  kind: TimerKind;
}
