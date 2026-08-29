import {
  Building2,
  LayoutGrid,
  MapPinned,
  MonitorSmartphone,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type TopicVisual = {
  icon: LucideIcon;
  surfaceClassName: string;
  iconClassName: string;
};

const topicVisuals: Record<string, TopicVisual> = {
  'accounts-and-systems': {
    icon: MonitorSmartphone,
    surfaceClassName: 'bg-[#dcebe5]',
    iconClassName: 'bg-[#0f594d] text-white',
  },
  arrival: {
    icon: MapPinned,
    surfaceClassName: 'bg-[#f3dfb4]',
    iconClassName: 'bg-[#a45f16] text-white',
  },
  'student-services': {
    icon: Building2,
    surfaceClassName: 'bg-[#dce8f2]',
    iconClassName: 'bg-[#376781] text-white',
  },
  'using-this-guide': {
    icon: ShieldCheck,
    surfaceClassName: 'bg-[#eedbd3]',
    iconClassName: 'bg-[#9a4f3b] text-white',
  },
};

const fallbackVisual: TopicVisual = {
  icon: LayoutGrid,
  surfaceClassName: 'bg-muted',
  iconClassName: 'bg-primary text-primary-foreground',
};

export function topicVisualFor(slug: string) {
  return topicVisuals[slug] ?? fallbackVisual;
}
