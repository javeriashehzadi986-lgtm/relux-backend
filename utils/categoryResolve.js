const Category = require("../models/Category");

const LEGACY_SLUG_TO_NAME = {
  female: "Female",
  male: "Male",
  kids: "Kids",
};

async function getActiveMainCategories() {
  return Category.find({ type: "main", isActive: true }).sort({ sortOrder: 1, name: 1 });
}

async function getAllMainCategories() {
  return Category.find({ type: "main" }).sort({ sortOrder: 1, name: 1 });
}

async function resolveMainBySlug(slug) {
  if (!slug) return null;
  const normalized = String(slug).trim().toLowerCase();
  const doc = await Category.findOne({
    slug: normalized,
    type: "main",
    isActive: true,
  });
  if (doc) return doc;

  const legacyName = LEGACY_SLUG_TO_NAME[normalized];
  if (!legacyName) return null;

  return {
    name: legacyName,
    slug: normalized,
    toJSON() {
      return this;
    },
  };
}

async function buildNameToSlugMap() {
  const mains = await getAllMainCategories();
  const map = {};
  for (const main of mains) {
    if (main.name) map[main.name] = main.slug;
  }
  for (const [slug, name] of Object.entries(LEGACY_SLUG_TO_NAME)) {
    if (!map[name]) map[name] = slug;
  }
  return map;
}

function categoryPathForSlug(slug) {
  if (!slug) return "/categories";
  return `/category/${slug}`;
}

module.exports = {
  LEGACY_SLUG_TO_NAME,
  getActiveMainCategories,
  getAllMainCategories,
  resolveMainBySlug,
  buildNameToSlugMap,
  categoryPathForSlug,
};
