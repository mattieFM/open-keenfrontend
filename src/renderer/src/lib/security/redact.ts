const SECRET_KEYS = /(^|_)(api[_-]?key|authorization|credential|master|read[_-]?key|write[_-]?key|access[_-]?key|organization[_-]?key|token|password|secret)($|_)/i;

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export function redactUnknown(value: unknown, knownSecrets: string[] = []): unknown {
  const redactString = (input: string): string => {
    let output = input;
    for (const secret of knownSecrets.filter(Boolean)) output = output.split(secret).join('<redacted>');
    output = output.replace(/(Authorization\s*[:=]\s*)([^\s,;]+)/gi, '$1<redacted>');
    output = output.replace(/([?&]api_key=)[^&#\s]+/gi, '$1<redacted>');
    return output;
  };

  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, knownSecrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEYS.test(key) ? '<redacted>' : redactUnknown(item, knownSecrets)
    ]));
  }
  return value;
}
