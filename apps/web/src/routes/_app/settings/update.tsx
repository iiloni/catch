import { createFileRoute } from '@tanstack/react-router';
import { AppUpdate } from '@/components/AppUpdate/AppUpdate';

export const Route = createFileRoute('/_app/settings/update')({ component: AppUpdate });
