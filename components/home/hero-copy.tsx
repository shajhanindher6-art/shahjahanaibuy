'use client';

/**
 * Localised hero copy (header/hero scope of the dictionary only —
 * see lib/i18n.ts for the stated limit: the rest of the page stays
 * English). The homepage itself is a server component, so the
 * language-dependent text lives in this small client component.
 */

import Link from 'next/link';
import { ArrowRight, Camera, Check, Gift, Puzzle, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { tFor } from '@/lib/i18n';
import type { Language } from '@/lib/region';
import { useRegion } from '@/components/region/region-provider';

/**
 * HONEST SUBTITLE OVERRIDE (A2 audit, 2026-11-03): the dictionary
 * heroSubtitle in lib/i18n.ts (outside this workstream's files)
 * used to claim a catalog scale the site does not have ("millions"
 * of products); the scale wording was removed from all 8 languages
 * on 2026-11-06, but this component still does NOT render
 * tFor(language, 'heroSubtitle'): it renders the honest subtitle
 * below instead, which claims only what the site does (search its
 * catalog, compare recorded retailer prices, explain its picks)
 * and no catalog size at all, so it cannot go stale as the catalog
 * grows. The dictionary strings are left for the coordinator to
 * move these honest strings into lib/i18n.ts in a later pass.
 */
const HONEST_SUBTITLE: Record<Language, string> = {
  en: 'SmartBuy AI searches our catalog, compares recorded retailer prices, and explains its picks — so you can find a good deal and shop with confidence.',
  ur: 'SmartBuy AI hamare catalog mein search karta hai, retailers ki recorded prices compare karta hai aur apni picks ki wajah batata hai — taake aap achi deal dhoond sakein aur itminan se shopping karein.',
  de: 'SmartBuy AI durchsucht unseren Katalog, vergleicht erfasste Händlerpreise und erklärt seine Empfehlungen — damit du gute Angebote findest und mit gutem Gefühl einkaufst.',
  fr: 'SmartBuy AI recherche dans notre catalogue, compare les prix enregistrés des commerçants et explique ses choix — pour vous aider à trouver une bonne affaire et à acheter en toute confiance.',
  es: 'SmartBuy AI busca en nuestro catálogo, compara los precios registrados de las tiendas y explica sus recomendaciones, para que encuentres una buena oferta y compres con confianza.',
  it: 'SmartBuy AI cerca nel nostro catalogo, confronta i prezzi registrati dei rivenditori e spiega le sue scelte, così puoi trovare una buona offerta e acquistare in tutta sicurezza.',
  pt: 'O SmartBuy AI pesquisa nosso catálogo, compara os preços registrados das lojas e explica suas escolhas, para você encontrar uma boa oferta e comprar com confiança.',
  tr: 'SmartBuy AI kataloğumuzda arama yapar, kayıtlı mağaza fiyatlarını karşılaştırır ve seçimlerinin nedenini açıklar — böylece iyi bir fırsat bulup güvenle alışveriş yapabilirsiniz.',
  // Added 2026-11-10 (i18n 8→20): machine translations of the honest
  // subtitle above, not professionally reviewed.
  ar: 'يبحث SmartBuy AI في كتالوجنا، ويقارن أسعار المتاجر المسجلة، ويشرح اختياراته — لتتمكن من العثور على صفقة جيدة والتسوق بثقة.',
  zh: 'SmartBuy AI 会搜索我们的商品目录，比较已记录的零售商价格，并解释其推荐理由——让您找到划算的交易并放心购物。',
  ja: 'SmartBuy AIはカタログを検索し、記録された小売価格を比較し、選んだ理由を説明します——良いお買い得品を見つけ、自信を持って買い物できるように。',
  ko: 'SmartBuy AI는 카탈로그를 검색하고 기록된 판매자 가격을 비교하며 추천 이유를 설명합니다. 좋은 특가를 찾고 자신 있게 쇼핑하세요.',
  hi: 'SmartBuy AI हमारे कैटलॉग में खोज करता है, दर्ज की गई रिटेलर कीमतों की तुलना करता है और अपनी पसंद की वजह बताता है — ताकि आप अच्छी डील पा सकें और भरोसे से खरीदारी कर सकें।',
  bn: 'SmartBuy AI আমাদের ক্যাটালগে খোঁজে, রেকর্ড করা খুচরা বিক্রেতাদের দাম তুলনা করে এবং তার পছন্দের কারণ ব্যাখ্যা করে — যাতে আপনি ভালো ডিল খুঁজে পান এবং আত্মবিশ্বাসের সঙ্গে কেনাকাটা করতে পারেন।',
  nl: 'SmartBuy AI doorzoekt onze catalogus, vergelijkt geregistreerde winkelprijzen en legt zijn keuzes uit — zodat je een goede deal vindt en met vertrouwen winkelt.',
  sv: 'SmartBuy AI söker i vår katalog, jämför registrerade butikspriser och förklarar sina val — så att du kan hitta ett bra erbjudande och handla med tillförsikt.',
  pl: 'SmartBuy AI przeszukuje nasz katalog, porównuje zapisane ceny sprzedawców i wyjaśnia swoje rekomendacje — abyś mógł znaleźć dobrą ofertę i robić zakupy z pewnością.',
  ru: 'SmartBuy AI ищет в нашем каталоге, сравнивает записанные цены продавцов и объясняет свои рекомендации — чтобы вы могли найти выгодное предложение и покупать с уверенностью.',
  id: 'SmartBuy AI mencari di katalog kami, membandingkan harga toko yang tercatat, dan menjelaskan pilihannya — sehingga Anda dapat menemukan penawaran bagus dan berbelanja dengan percaya diri.',
  vi: 'SmartBuy AI tìm kiếm trong danh mục của chúng tôi, so sánh giá đã ghi của các nhà bán lẻ và giải thích lựa chọn của mình — để bạn tìm được ưu đãi tốt và mua sắm một cách tự tin.',
};

export function HeroCopy() {
  const { language } = useRegion();
  return (
    <>
      <Badge variant="secondary" className="mb-4 gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        {tFor(language, 'heroBadge')}
      </Badge>
      <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
        {tFor(language, 'heroTitleA')}{' '}
        <span className="bg-gradient-to-r from-primary to-chart-4 bg-clip-text text-transparent">
          {tFor(language, 'heroTitleB')}
        </span>{' '}
        {tFor(language, 'heroTitleC')}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        {HONEST_SUBTITLE[language] ?? HONEST_SUBTITLE.en}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" asChild>
          <Link href="/sign-up">
            {tFor(language, 'heroCtaStart')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/search">
            <Search className="mr-2 h-4 w-4" />
            {tFor(language, 'heroCtaSearch')}
          </Link>
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
        <Link href="/scan" className="flex items-center gap-1.5 text-muted-foreground underline-offset-2 hover:underline">
          <Camera className="h-4 w-4" /> Scan a product photo
        </Link>
        <Link href="/gifts" className="flex items-center gap-1.5 text-muted-foreground underline-offset-2 hover:underline">
          <Gift className="h-4 w-4" /> Find a gift
        </Link>
        <Link href="/extension" className="flex items-center gap-1.5 text-muted-foreground underline-offset-2 hover:underline">
          <Puzzle className="h-4 w-4" /> Extension & integrations
        </Link>
      </div>
      <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Check className="h-4 w-4 text-success" />
          {tFor(language, 'heroNoCard')}
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="h-4 w-4 text-success" />
          {tFor(language, 'heroFreeForever')}
        </span>
      </div>
    </>
  );
}
