import { Link } from '@tanstack/react-router';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { authClient, clearAuthToken } from '@/lib/auth';
import { type ThemePreference, useThemePreference } from '@/lib/theme';

const NAV = [
  { to: '/', label: 'Notes' },
  { to: '/archive', label: 'Archive' },
  { to: '/trash', label: 'Trash' },
] as const;

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Link to="/" className="mr-2 font-bold text-xl">
          Catch
        </Link>
        <nav aria-label="Main" className="flex gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true, includeSearch: false }}
              className="rounded-md px-2.5 py-1.5 text-muted-foreground text-sm hover:text-foreground data-[status=active]:bg-secondary data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <UserMenu />
      </div>
    </header>
  );
}

function initials(name: string, email: string) {
  const source = name.trim() || email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function UserMenu() {
  const { data: session } = authClient.useSession();
  const [theme, setTheme] = useThemePreference();
  const user = session?.user;

  async function signOut() {
    await authClient.signOut();
    clearAuthToken();
    // A full reload drops this user's synced notes from memory.
    window.location.assign('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="ml-auto flex size-9 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {user ? initials(user.name, user.email) : ''}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {user && (
          <DropdownMenuLabel className="flex flex-col">
            <span className="truncate">{user.name || user.email}</span>
            {user.name && (
              <span className="truncate font-normal text-muted-foreground text-xs">
                {user.email}
              </span>
            )}
          </DropdownMenuLabel>
        )}
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          Theme
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(value) => value && setTheme(value as ThemePreference)}
            aria-label="Theme"
          >
            <ToggleGroupItem value="system" aria-label="System theme">
              <Monitor />
            </ToggleGroupItem>
            <ToggleGroupItem value="light" aria-label="Light theme">
              <Sun />
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark theme">
              <Moon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
