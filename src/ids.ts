const PREFIX = /^[a-z]+$/;

export function createId(prefix: 'lead' | 'int' | 'fu'): string {
  if (!PREFIX.test(prefix)) {
    throw new Error(`Refusing to mint an id with prefix "${prefix}".`);
  }
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${prefix}_${hex}`;
}
