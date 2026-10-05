import { Compare } from '@/components/home/Compare';
import { Features } from '@/components/home/Features';
import { GetStarted } from '@/components/home/GetStarted';
import { Hero } from '@/components/home/Hero';
import { ImportKeep } from '@/components/home/ImportKeep';
import { LikeKeep } from '@/components/home/LikeKeep';
import { YoursToRun } from '@/components/home/YoursToRun';

export default function HomePage() {
  return (
    <>
      <Hero />
      <LikeKeep />
      <Features />
      <YoursToRun />
      <Compare />
      <ImportKeep />
      <GetStarted />
    </>
  );
}
