/**
 * AI price drop prediction service.
 * Analyzes historical price data to predict future discounts.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import type { PricePrediction } from '@/types/ai';

export interface PricePredictionResult {
  productId: string;
  discountProbability: number;
  expectedSaleDate: string | null;
  expectedLowestPrice: number | null;
  confidenceScore: number;
  explanation: string;
  currentPrice: number | null;
  averagePrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  price30Day: PriceTrendPoint[];
  price90Day: PriceTrendPoint[];
  price1Year: PriceTrendPoint[];
}

export interface PriceTrendPoint {
  date: string;
  price: number;
}

export async function predictPriceDrop(
  supabase: AnySupabaseClient,
  productId: string
): Promise<PricePredictionResult | null> {
  try {
    const cached = await getCachedPrediction(supabase, productId);
    if (cached) return cached;

    const { data: priceData, error } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: true })
      .limit(365);

    if (error || !priceData || priceData.length === 0) {
      if (error) logger.warn('predictPriceDrop: query failed', { error: error.message });
      return null;
    }

    const prices = (priceData as Array<Record<string, unknown>>).map((r) => ({
      price: parseFloat(String(r.price)),
      date: r.recorded_at as string,
    }));

    const priceValues = prices.map((p) => p.price);
    const currentPrice = priceValues[priceValues.length - 1] ?? null;
    const lowestPrice = Math.min(...priceValues);
    const highestPrice = Math.max(...priceValues);
    const averagePrice = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const price30Day = prices.filter((p) => new Date(p.date) >= thirtyDaysAgo);
    const price90Day = prices.filter((p) => new Date(p.date) >= ninetyDaysAgo);
    const price1Year = prices.filter((p) => new Date(p.date) >= oneYearAgo);

    const discountProbability = calculateDiscountProbability(prices, currentPrice, averagePrice, lowestPrice);
    const expectedSaleDate = predictSaleDate(prices);
    const expectedLowestPrice = predictLowestPrice(currentPrice, lowestPrice, averagePrice);
    const confidenceScore = calculateConfidence(prices.length, priceValues);

    const explanation = buildPredictionExplanation({
      currentPrice,
      averagePrice,
      lowestPrice,
      highestPrice,
      discountProbability,
      expectedSaleDate,
      expectedLowestPrice,
      confidenceScore,
    });

    const result: PricePredictionResult = {
      productId,
      discountProbability,
      expectedSaleDate,
      expectedLowestPrice,
      confidenceScore,
      explanation,
      currentPrice,
      averagePrice,
      lowestPrice,
      highestPrice,
      price30Day: price30Day.map((p) => ({ date: p.date, price: p.price })),
      price90Day: price90Day.map((p) => ({ date: p.date, price: p.price })),
      price1Year: price1Year.map((p) => ({ date: p.date, price: p.price })),
    };

    void storePrediction(supabase, productId, result);

    return result;
  } catch (err) {
    logger.error('predictPriceDrop: unexpected error', { error: String(err) });
    return null;
  }
}

function calculateDiscountProbability(
  prices: Array<{ price: number; date: string }>,
  currentPrice: number | null,
  averagePrice: number,
  lowestPrice: number
): number {
  if (!currentPrice || prices.length < 5) return 0;

  const recentPrices = prices.slice(-10).map((p) => p.price);
  const recentAvg = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;

  const priceAboveAverage = currentPrice > averagePrice;
  const priceAboveLowest = currentPrice > lowestPrice;
  const priceDropFromPeak = currentPrice > lowestPrice ? (currentPrice - lowestPrice) / currentPrice : 0;

  let probability = 0;
  if (priceAboveAverage) probability += 30;
  if (priceAboveLowest) probability += 20;
  if (priceDropFromPeak > 0.1) probability += 20;
  if (recentAvg > averagePrice) probability += 15;
  if (prices.length > 30) probability += 15;

  return Math.min(95, Math.max(0, probability));
}

function predictSaleDate(prices: Array<{ price: number; date: string }>): string | null {
  if (prices.length < 10) return null;

  const lowestPrice = Math.min(...prices.map((p) => p.price));
  const lowestPriceEntries = prices.filter((p) => p.price === lowestPrice);

  if (lowestPriceEntries.length === 0) return null;

  const lowestDate = new Date(lowestPriceEntries[0].date);
  const now = new Date();
  const monthsSinceLowest = (now.getTime() - lowestDate.getTime()) / (30 * 24 * 60 * 60 * 1000);

  if (monthsSinceLowest < 3) {
    const nextSale = new Date(lowestDate);
    nextSale.setMonth(nextSale.getMonth() + 6);
    return nextSale.toISOString().split('T')[0];
  }

  const nextSale = new Date(now);
  nextSale.setMonth(nextSale.getMonth() + 1);
  return nextSale.toISOString().split('T')[0];
}

function predictLowestPrice(
  currentPrice: number | null,
  historicalLowest: number,
  averagePrice: number
): number | null {
  if (!currentPrice) return null;
  const halfwayPoint = (historicalLowest + averagePrice) / 2;
  return Math.round((historicalLowest + halfwayPoint) / 2);
}

function calculateConfidence(dataPoints: number, prices: number[]): number {
  if (dataPoints < 10) return 20;
  if (dataPoints < 30) return 40;
  if (dataPoints < 90) return 60;
  if (dataPoints < 200) return 75;

  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const coefficient = stdDev / avg;

  if (coefficient < 0.1) return 90;
  if (coefficient < 0.2) return 80;
  return 70;
}

function buildPredictionExplanation(data: {
  currentPrice: number | null;
  averagePrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  discountProbability: number;
  expectedSaleDate: string | null;
  expectedLowestPrice: number | null;
  confidenceScore: number;
}): string {
  const parts: string[] = [];

  if (data.currentPrice && data.averagePrice) {
    if (data.currentPrice > data.averagePrice) {
      parts.push(`The current price ($${data.currentPrice.toFixed(2)}) is above the historical average ($${data.averagePrice.toFixed(2)}), suggesting a discount is likely.`);
    } else {
      parts.push(`The current price ($${data.currentPrice.toFixed(2)}) is at or below the historical average ($${data.averagePrice.toFixed(2)}), suggesting it may be a good time to buy.`);
    }
  }

  if (data.lowestPrice && data.currentPrice) {
    const potentialSavings = data.currentPrice - data.lowestPrice;
    if (potentialSavings > 0) {
      parts.push(`The lowest recorded price was $${data.lowestPrice.toFixed(2)}, meaning you could potentially save $${potentialSavings.toFixed(2)}.`);
    }
  }

  parts.push(`There is a ${data.discountProbability.toFixed(0)}% probability of a price drop in the near future.`);

  if (data.expectedSaleDate) {
    parts.push(`The next significant sale is predicted around ${data.expectedSaleDate}.`);
  }

  if (data.expectedLowestPrice) {
    parts.push(`The expected lowest price during the next sale is approximately $${data.expectedLowestPrice.toFixed(2)}.`);
  }

  parts.push(`This prediction has a ${data.confidenceScore.toFixed(0)}% confidence score based on available historical data.`);

  return parts.join(' ');
}

async function getCachedPrediction(
  supabase: AnySupabaseClient,
  productId: string
): Promise<PricePredictionResult | null> {
  const key = cacheKey('prediction', productId);
  return swrGet<PricePredictionResult | null>(
    key,
    async () => {
      const { data } = await supabase
        .from('ai_predictions')
        .select('*')
        .eq('product_id', productId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        productId: row.product_id as string,
        discountProbability: parseFloat(String(row.discount_probability)),
        expectedSaleDate: row.expected_sale_date as string | null,
        expectedLowestPrice: row.expected_lowest_price ? parseFloat(String(row.expected_lowest_price)) : null,
        confidenceScore: parseFloat(String(row.confidence_score)),
        explanation: row.explanation as string,
        currentPrice: null,
        averagePrice: null,
        lowestPrice: null,
        highestPrice: null,
        price30Day: [],
        price90Day: [],
        price1Year: [],
      };
    },
    60_000,
    300_000
  );
}

async function storePrediction(
  supabase: AnySupabaseClient,
  productId: string,
  result: PricePredictionResult
): Promise<void> {
  try {
    await supabase.from('ai_predictions').insert({
      product_id: productId,
      prediction_type: 'price_drop',
      discount_probability: result.discountProbability,
      expected_sale_date: result.expectedSaleDate,
      expected_lowest_price: result.expectedLowestPrice,
      confidence_score: result.confidenceScore,
      explanation: result.explanation,
    });
  } catch (err) {
    logger.warn('storePrediction: insert failed', { error: String(err) });
  }
}
