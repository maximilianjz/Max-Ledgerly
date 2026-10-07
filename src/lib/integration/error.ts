// Shared by the browser's price preview and the server's integration functions.
export class IntegrationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
