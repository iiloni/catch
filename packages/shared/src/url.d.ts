/**
 * `URL` is global in browsers and Node alike but in neither's ES lib, and this package takes
 * no DOM or Node types. These are the parts of it the package uses.
 */
declare class URL {
  constructor(url: string, base?: string | URL);
  href: string;
  protocol: string;
  hostname: string;
  pathname: string;
  hash: string;
}
