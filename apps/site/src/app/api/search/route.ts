import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// Written once at build time, as the export has no server to answer a query.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
