import type { MetadataRoute } from "next";

import { services } from "@/data/services";
import { SITE_URL } from "@/lib/constants";

const staticRoutes = [
  "/",
  "/about",
  "/services",
  "/doctors",
  "/contact",
  "/appointment",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    ...staticRoutes.map((route) => ({
      url: `${SITE_URL}${route}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: route === "/" ? 1 : 0.7,
    })),
    ...services.map((service) => ({
      url: `${SITE_URL}/services/${service.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
