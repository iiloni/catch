import { createFileRoute } from '@tanstack/react-router';

// MainPagePager keeps the incoming page mounted when a swipe commits the route.
export const Route = createFileRoute('/_app/deck')({ component: () => null });
