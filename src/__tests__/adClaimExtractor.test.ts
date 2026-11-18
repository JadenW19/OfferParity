import { describe, expect, it } from "vitest";
import { extractAdClaims } from "@/lib/parser/adClaimExtractor";
import { ExtractedAdClaimsSchema } from "@/lib/schemas";

describe("extractAdClaims (Gate 1 — Deterministic Ad Claim Extractor)", () => {
  describe("canonical offer scenarios", () => {
    it("extracts Healthy Offer claims with sale/anchor prices, promo, discount, variant, and UTMs", () => {
      const adCopy =
        "Lumina 32oz Insulated Bottle in Obsidian Black — Now $36.00 (20% OFF $45.00). Apply \"HYDRATE20\" at checkout. Free shipping on orders over $75!";
      const url =
        "https://demo.offerparity.app/products/lumina-bottle?utm_source=meta&utm_medium=paid_social&utm_campaign=q4_lumina_launch&fbclid=IwAR123";

      const result = extractAdClaims(adCopy, url);
      expect(() => ExtractedAdClaimsSchema.parse(result)).not.toThrow();

      expect(result.advertisedPrice).toBe(36);
      expect(result.compareAtPrice).toBe(45);
      expect(result.currency).toBe("USD");
      expect(result.promoCode).toBe("HYDRATE20");
      expect(result.discountPct).toBe(20);
      expect(result.isUpToDiscount).toBe(false);
      expect(result.variantName).toBe("Obsidian Black");
      expect(result.utmParams).toEqual({
        utm_source: "meta",
        utm_medium: "paid_social",
        utm_campaign: "q4_lumina_launch",
        utm_content: null,
        utm_term: null,
        fbclid: "IwAR123",
        ttclid: null,
        gclid: null,
      });
      expect(result.signals.map((s) => s.field)).toEqual(
        expect.arrayContaining([
          "advertisedPrice",
          "compareAtPrice",
          "currency",
          "promoCode",
          "discountPct",
          "variantName",
          "utmParams",
        ])
      );
    });

    it("extracts Expired Promo scenario claims", () => {
      const adCopy =
        "Veloce Recovery Boots — 25% OFF ($149.25, reg $199.00). Promo: BFCM25.";
      const url =
        "https://demo.offerparity.app/products/veloce-boots?utm_source=tiktok&utm_medium=paid_social&utm_campaign=bfcm_boots";

      const result = extractAdClaims(adCopy, url);
      expect(result.advertisedPrice).toBe(149.25);
      expect(result.compareAtPrice).toBe(199);
      expect(result.currency).toBe("USD");
      expect(result.promoCode).toBe("BFCM25");
      expect(result.discountPct).toBe(25);
      expect(result.isUpToDiscount).toBe(false);
    });

    it("extracts OOS Variant & Price Mismatch scenario claims", () => {
      const adCopy =
        "Kova Merino Trail Hoodie (100% Merino wool) in Alpine Olive (Size L) — $68.00 today only!";
      const url =
        "https://demo.offerparity.app/products/kova-hoodie?utm_source=meta&utm_medium=cpc";

      const result = extractAdClaims(adCopy, url);
      expect(result.advertisedPrice).toBe(68);
      expect(result.compareAtPrice).toBeNull();
      expect(result.currency).toBe("USD");
      expect(result.promoCode).toBeNull();
      expect(result.discountPct).toBeNull();
      expect(result.variantName).toBe("Alpine Olive (Size L)");
      expect(result.utmParams.utm_source).toBe("meta");
      expect(result.utmParams.utm_medium).toBe("cpc");
      expect(result.utmParams.utm_campaign).toBeNull();
    });
  });

  describe("multi-currency price & anchor extraction", () => {
    it("supports GBP (£ / GBP), EUR (€ / EUR + comma decimals), CAD (CA$ / CAD), and AUD (AU$ / AUD)", () => {
      expect(extractAdClaims("Grab yours for £29.99 today", "https://shop.co.uk")).toMatchObject({
        advertisedPrice: 29.99,
        currency: "GBP",
      });

      expect(extractAdClaims("Only 34.50 GBP", "https://shop.co.uk")).toMatchObject({
        advertisedPrice: 34.5,
        currency: "GBP",
      });

      expect(extractAdClaims("Special offer €49,99", "https://shop.eu")).toMatchObject({
        advertisedPrice: 49.99,
        currency: "EUR",
      });

      expect(extractAdClaims("Launch price 59.00 EUR", "https://shop.eu")).toMatchObject({
        advertisedPrice: 59,
        currency: "EUR",
      });

      expect(extractAdClaims("Now CA$65.00 (was CA$85.00)", "https://shop.ca")).toMatchObject({
        advertisedPrice: 65,
        compareAtPrice: 85,
        currency: "CAD",
      });

      expect(extractAdClaims("Just $65.00 CAD", "https://shop.ca")).toMatchObject({
        advertisedPrice: 65,
        currency: "CAD",
      });

      expect(extractAdClaims("AU$79.00 limited drop", "https://shop.com.au")).toMatchObject({
        advertisedPrice: 79,
        currency: "AUD",
      });

      expect(extractAdClaims("Now $1,299.00 AUD", "https://shop.com.au")).toMatchObject({
        advertisedPrice: 1299,
        currency: "AUD",
      });
    });

    it("parses arrow transitions ($199 -> $149.25) and save $X off $Y patterns", () => {
      const arrow = extractAdClaims("Price drop: $199 -> $149.25", "https://example.com");
      expect(arrow.compareAtPrice).toBe(199);
      expect(arrow.advertisedPrice).toBe(149.25);

      const saveOff = extractAdClaims("Save $10 off $50 this weekend!", "https://example.com");
      expect(saveOff.compareAtPrice).toBe(50);
      expect(saveOff.advertisedPrice).toBe(40);
      expect(saveOff.signals.find((s) => s.field === "advertisedPrice")?.source).toBe("derived");

      const explicitPlusSave = extractAdClaims(
        "Only $38 — save $12 off $50!",
        "https://example.com"
      );
      expect(explicitPlusSave.advertisedPrice).toBe(38);
      expect(explicitPlusSave.compareAtPrice).toBe(50);
    });

    it("does not treat standalone savings amounts ('Save $15') as advertisedPrice", () => {
      const res = extractAdClaims("Save $15 on your first order today!", "https://example.com");
      expect(res.advertisedPrice).toBeNull();
    });
  });

  describe("shipping threshold exclusion", () => {
    it("excludes shipping threshold phrases before selecting advertisedPrice", () => {
      const onlyShipping = extractAdClaims(
        "Free shipping on orders over $75! Shop our new arrivals.",
        "https://example.com"
      );
      expect(onlyShipping.advertisedPrice).toBeNull();

      const shippingPlusPrice = extractAdClaims(
        "Free shipping on orders over $75. Get the bottle now for $36.00!",
        "https://example.com"
      );
      expect(shippingPlusPrice.advertisedPrice).toBe(36);
      expect(
        shippingPlusPrice.signals.find((s) => s.field === "advertisedPrice")?.note
      ).toContain("Free shipping on orders over $75");

      const ordersPlus = extractAdClaims(
        "Orders $50+ ship free. Trail Socks just $18.00.",
        "https://example.com"
      );
      expect(ordersPlus.advertisedPrice).toBe(18);
    });

    it("does not accidentally strip product prices that follow 'Free shipping on'", () => {
      const res = extractAdClaims(
        "Free shipping on $36 Lumina Bottle today!",
        "https://example.com"
      );
      expect(res.advertisedPrice).toBe(36);
    });
  });

  describe("promo code extraction & stopword filtering", () => {
    it("extracts valid uppercase alphanumeric promo codes from contextual patterns", () => {
      expect(extractAdClaims("Use code SAVE20 at checkout", "https://example.com").promoCode).toBe(
        "SAVE20"
      );
      expect(extractAdClaims("Promo: BFCM25", "https://example.com").promoCode).toBe("BFCM25");
      expect(
        extractAdClaims('Apply "HYDRATE20" at checkout', "https://example.com").promoCode
      ).toBe("HYDRATE20");
      expect(
        extractAdClaims("Enter promo code VIP-2026!", "https://example.com").promoCode
      ).toBe("VIP-2026");
    });

    it("filters out stopwords, short/long tokens, bare numbers, and negated phrases", () => {
      const stopwords = [
        "CHECKOUT",
        "TODAY",
        "HERE",
        "FREE",
        "LINK",
        "NOW",
        "CODE",
        "PROMO",
        "ORDER",
        "ORDERS",
        "SHIPPING",
        "SAVE",
        "OFF",
        "ONLY",
      ];

      for (const word of stopwords) {
        const res = extractAdClaims(`Use code ${word} at checkout`, "https://example.com");
        expect(res.promoCode).toBeNull();
      }

      expect(extractAdClaims("Apply TODAY at checkout", "https://example.com").promoCode).toBeNull();
      expect(extractAdClaims("Use code AB at checkout", "https://example.com").promoCode).toBeNull();
      expect(
        extractAdClaims("Use code SUPERLONGPROMOCODETHATEXCEEDSLIMIT", "https://example.com")
          .promoCode
      ).toBeNull();
      expect(extractAdClaims("Use code 12345 at checkout", "https://example.com").promoCode).toBeNull();
      expect(
        extractAdClaims("No promo code needed — automatic discount", "https://example.com")
          .promoCode
      ).toBeNull();
    });
  });

  describe("discount percentage extraction", () => {
    it("distinguishes flat discounts from 'up to' ceilings and ignores non-discount percentages", () => {
      const flat1 = extractAdClaims("Flash sale: 25% OFF everything", "https://example.com");
      expect(flat1.discountPct).toBe(25);
      expect(flat1.isUpToDiscount).toBe(false);

      const flat2 = extractAdClaims("Save 20% on your order", "https://example.com");
      expect(flat2.discountPct).toBe(20);
      expect(flat2.isUpToDiscount).toBe(false);

      const upTo = extractAdClaims("Save up to 40% off winter gear", "https://example.com");
      expect(upTo.discountPct).toBe(40);
      expect(upTo.isUpToDiscount).toBe(true);

      const fabricOnly = extractAdClaims(
        "Made with 100% organic cotton and 99% recycled nylon — $48",
        "https://example.com"
      );
      expect(fabricOnly.discountPct).toBeNull();
      expect(fabricOnly.isUpToDiscount).toBe(false);
    });
  });

  describe("hero variant extraction", () => {
    it("extracts color, size, pack-count, and flavor claims from ad copy", () => {
      expect(
        extractAdClaims("Hoodie in Alpine Olive (Size L) — $68", "https://example.com")
          .variantName
      ).toBe("Alpine Olive (Size L)");

      expect(
        extractAdClaims("Color: Obsidian Black. Limited stock.", "https://example.com")
          .variantName
      ).toBe("Obsidian Black");

      expect(
        extractAdClaims("Variant: 2-Pack — Save $10 today", "https://example.com").variantName
      ).toBe("2-Pack");

      expect(
        extractAdClaims("Available in Size L for $49", "https://example.com").variantName
      ).toBe("Size L");
    });

    it("falls back to URL query hints (?variant, ?color, ?size) and lets ad copy take precedence", () => {
      const fromVariantParam = extractAdClaims(
        "Shop the new drop for $49",
        "https://example.com/products/shirt?variant=obsidian-black"
      );
      expect(fromVariantParam.variantName).toBe("obsidian-black");
      expect(fromVariantParam.signals.find((s) => s.field === "variantName")?.source).toBe(
        "landing_url"
      );

      const fromColorAndSize = extractAdClaims(
        "Shop now for $68",
        "https://example.com/products/hoodie?color=Alpine+Olive&size=L"
      );
      expect(fromColorAndSize.variantName).toBe("Alpine Olive / L");

      const fromSizeOnly = extractAdClaims(
        "Shop now for $68",
        "https://example.com/products/hoodie?size=XL"
      );
      expect(fromSizeOnly.variantName).toBe("Size XL");

      const adWinsOverShopifyId = extractAdClaims(
        "Bottle in Obsidian Black — $36",
        "https://example.com/products/bottle?variant=44556677889"
      );
      expect(adWinsOverShopifyId.variantName).toBe("Obsidian Black");
      expect(adWinsOverShopifyId.variantId).toBe("44556677889");
    });

    it("extracts numeric Shopify ?variant=<id> and /discount/<code> URL claims", () => {
      const shopifyShareUrl =
        "https://brand.example.com/discount/SPRING25?redirect=/products/trail-hoodie&variant=445566778890&utm_source=meta&utm_medium=paid_social&utm_campaign=spring";
      const result = extractAdClaims("Limited-time offer — now $59.25!", shopifyShareUrl);
      expect(result.promoCode).toBe("SPRING25");
      expect(result.variantId).toBe("445566778890");
      expect(result.variantName).toBeNull();
      expect(result.signals.map((s) => s.field)).toEqual(
        expect.arrayContaining(["promoCode", "variantId", "utmParams"])
      );
    });
  });

  describe("UTM & click-ID hygiene and empty/edge inputs", () => {
    it("parses all 8 UTM & click-ID parameters and treats blank values as null", () => {
      const url =
        "https://brand.com/products/item?utm_source=google&utm_medium=cpc&utm_campaign=&utm_content=video_a&utm_term=trail+hoodie&fbclid=fb1&ttclid=tt2&gclid=gc3";

      const result = extractAdClaims("Trail hoodie $80", url);
      expect(result.utmParams).toEqual({
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: null,
        utm_content: "video_a",
        utm_term: "trail hoodie",
        fbclid: "fb1",
        ttclid: "tt2",
        gclid: null === null ? "gc3" : null,
      });
    });

    it("handles empty and malformed inputs cleanly without throwing", () => {
      const empty = extractAdClaims("", "");
      expect(() => ExtractedAdClaimsSchema.parse(empty)).not.toThrow();
      expect(empty).toEqual({
        advertisedPrice: null,
        compareAtPrice: null,
        currency: null,
        promoCode: null,
        discountPct: null,
        isUpToDiscount: false,
        variantId: null,
        variantName: null,
        utmParams: {
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          fbclid: null,
          ttclid: null,
          gclid: null,
        },
        signals: [],
      });

      const malformed = extractAdClaims("   ", "not-a-valid-url");
      expect(() => ExtractedAdClaimsSchema.parse(malformed)).not.toThrow();
      expect(malformed.advertisedPrice).toBeNull();
      expect(malformed.utmParams.utm_source).toBeNull();
    });
  });
});
