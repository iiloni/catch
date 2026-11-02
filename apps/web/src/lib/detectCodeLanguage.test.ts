import { describe, expect, it } from 'vitest';
import { detectCodeLanguage } from './detectCodeLanguage';

describe('code language detection', () => {
  it.each([
    ['def greet(name):\n    print("Hello, " + name)\n    return True', 'python'],
    ['const greeting = "Hello";\nconsole.log(greeting);', 'javascript'],
    [
      'interface User { name: string; age: number; }\nconst user: User = { name: "Joe", age: 3 };',
      'typescript',
    ],
    ['{"name":"Catch","version":1,"enabled":true}', 'json'],
  ])('recognizes a useful snippet: %s', (source, language) => {
    expect(detectCodeLanguage(source)).toBe(language);
  });

  it.each(['', 'x = 1', 'just some ordinary words to remember for later', 'hello world'])(
    'leaves short or unconvincing text alone: %j',
    (source) => {
      expect(detectCodeLanguage(source)).toBeUndefined();
    },
  );
});
