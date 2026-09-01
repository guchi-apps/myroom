import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/**
 * バックエンド（`weather.describe_weather_code`）が返すアイコン種別を
 * lucide-react の既存アイコンへ対応させる（#308）。新規の依存追加は不要。
 */
const WEATHER_ICON_MAP: Record<string, LucideIcon> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

export function getWeatherIcon(icon?: string | null): LucideIcon {
  return (icon && WEATHER_ICON_MAP[icon]) || Cloud;
}

/**
 * `icon`種別に応じたアイコンを描く。`switch`で各アイコンをJSXタグとして直接返すのは、
 * `const Icon = getWeatherIcon(...)` のように変数へ入れてからタグにすると
 * 「レンダー中にコンポーネントを生成している」と静的解析に判定されるため。
 */
export function WeatherIcon({ icon, ...props }: { icon?: string | null } & LucideProps) {
  switch (icon) {
    case "sun":
      return <Sun {...props} />;
    case "cloud-sun":
      return <CloudSun {...props} />;
    case "fog":
      return <CloudFog {...props} />;
    case "rain":
      return <CloudRain {...props} />;
    case "snow":
      return <CloudSnow {...props} />;
    case "storm":
      return <CloudLightning {...props} />;
    default:
      return <Cloud {...props} />;
  }
}
