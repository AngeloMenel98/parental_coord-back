/** Cola BullMQ del recordatorio único de gastos pendientes (T23). */
export const EXPENSE_STALE_REMINDER_QUEUE = 'expense-stale-reminder';
export const EXPENSE_STALE_REMINDER_JOB_NAME = 'send-stale-reminders';
export const EXPENSE_STALE_REMINDER_SCHEDULER_ID = 'expense-stale-reminder-daily';
export const DEFAULT_EXPENSE_STALE_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
