import type { AuthResult, Book, Loan } from '@/types';
import { ApiRequestError } from './client';

function invalid(): never {
  throw new ApiRequestError(502, 'INVALID_RESPONSE', 'La API devolvió datos incompletos. Reintenta la consulta.');
}
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
const text = (x: unknown): x is string => typeof x === 'string';
const date = (x: unknown) => text(x) && Number.isFinite(Date.parse(x));
const nullableDate = (x: unknown) => x === null || date(x);

export function parseAuth(x: unknown): AuthResult {
  if (!record(x) || !record(x.user) || !record(x.tokens)) invalid();
  const { user: u, tokens: t } = x;
  if (!text(u.uid) || !u.uid || !text(u.email) || !text(u.name) ||
      !['student', 'librarian'].includes(String(u.role)) ||
      !text(t.idToken) || !t.idToken || !text(t.refreshToken) || !t.refreshToken ||
      typeof t.expiresIn !== 'number' || !Number.isFinite(t.expiresIn) || t.expiresIn <= 0) invalid();
  return x as unknown as AuthResult;
}

export function parseBook(x: unknown): Book {
  if (!record(x) || !['id', 'title', 'author', 'category', 'description'].every(k => text(x[k])) ||
      !date(x.updatedAt) || !Number.isInteger(x.year) || !Number.isInteger(x.totalCopies) ||
      !Number.isInteger(x.availableCopies) || Number(x.availableCopies) < 0 ||
      Number(x.availableCopies) > Number(x.totalCopies) ||
      !(x.coverUrl === null || (text(x.coverUrl) && x.coverUrl.startsWith('/api/books/')))) invalid();
  return x as unknown as Book;
}

export function parseLoan(x: unknown): Loan {
  if (!record(x) || !['id', 'bookId', 'bookTitle', 'userId', 'userEmail', 'userName', 'clientRequestId'].every(k => text(x[k])) ||
      !['requested', 'approved', 'rejected', 'returned'].includes(String(x.status)) ||
      !date(x.requestedAt) || !date(x.updatedAt) ||
      ![x.resolvedAt, x.dueDate, x.returnedAt].every(nullableDate)) invalid();
  return x as unknown as Loan;
}

export function parseCatalog(x: unknown): { books: Book[]; serverTime: string } {
  if (!record(x) || !Array.isArray(x.books) || !date(x.serverTime)) invalid();
  return { books: x.books.map(parseBook), serverTime: x.serverTime as string };
}
export function parseLoans(x: unknown): Loan[] {
  if (!record(x) || !Array.isArray(x.loans)) invalid();
  return x.loans.map(parseLoan);
}
export function parseLoanResult(x: unknown): Loan {
  if (!record(x)) invalid();
  return parseLoan(x.loan);
}
