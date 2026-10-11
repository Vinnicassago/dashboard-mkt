import { ConfigSkeleton } from "@/components/config/config-skeleton";

/** Zona de perigo: um card só. */
export default function PerigoLoading() {
  return <ConfigSkeleton cards={1} />;
}
