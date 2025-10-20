// Logging utility with timestamps

function formatTimestamp(): string {
  const now = new Date();
  const hrs = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const secs = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hrs}:${mins}:${secs}.${ms}`;
}

export function log(message: string): void {
  const timestamp = Date.now();
  const human = formatTimestamp();
  console.error(`[${human}|${timestamp}] ${message}`);
}

export function logError(message: string, error?: any): void {
  const timestamp = Date.now();
  const human = formatTimestamp();
  if (error) {
    console.error(`[${human}|${timestamp}] ${message}:`, error);
  } else {
    console.error(`[${human}|${timestamp}] ${message}`);
  }
}

// For existing code that uses template strings
export function logf(parts: TemplateStringsArray, ...values: any[]): void {
  const message = String.raw({ raw: parts }, ...values);
  log(message);
}

