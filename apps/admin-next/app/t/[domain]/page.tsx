import TenantClient from "@/components/TenantClient";

export default async function TenantPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  return <TenantClient domain={decodeURIComponent(domain)} />;
}
