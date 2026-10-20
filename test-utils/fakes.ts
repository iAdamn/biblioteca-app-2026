import type { Book, Loan } from '@/types';

export function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'srv-1',
    bookId: 'b1',
    bookTitle: 'Clean Code',
    userId: 'u1',
    userEmail: 'a@b.co',
    userName: 'Ana',
    status: 'requested',
    clientRequestId: 'req-00000001',
    requestedAt: '2026-10-12T10:00:00.000Z',
    resolvedAt: null,
    dueDate: null,
    returnedAt: null,
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}

export function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    category: 'Tecnología',
    year: 2008,
    description: 'x',
    totalCopies: 2,
    availableCopies: 2,
    coverUrl: null,
    updatedAt: '2026-10-12T10:00:00.000Z',
    ...overrides,
  };
}


