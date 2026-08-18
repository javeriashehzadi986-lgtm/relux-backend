const Category = require("../models/Category");
const Product = require("../models/Product");

const MAIN_TO_PRODUCT = {
  female: "Female",
  male: "Male",
  kids: "Kids",
};

const DEFAULT_CATEGORIES = [
  {
    name: "Male",
    slug: "male",
    type: "main",
    icon: "man",
    iconVariant: "primary-dim",
    sortOrder: 1,
  },
  {
    name: "Female",
    slug: "female",
    type: "main",
    icon: "woman",
    iconVariant: "primary-container",
    sortOrder: 2,
  },
  {
    name: "Kids",
    slug: "kids",
    type: "main",
    icon: "child_care",
    iconVariant: "tertiary",
    sortOrder: 3,
  },
];

const SHARED_SUBS = [
  { name: "Casual Wear", productStyleKey: "Casual", sortOrder: 1 },
  { name: "Formal Wear", productStyleKey: "Formal", sortOrder: 2 },
  { name: "Party Wear", productStyleKey: "Party", sortOrder: 3 },
  { name: "Traditional Wear", productStyleKey: "Traditional", sortOrder: 4 },
  { name: "Winter Wear", productStyleKey: "Winter Wear", sortOrder: 5 },
];

const DEFAULT_SUBS = ["male", "female", "kids"].flatMap((parentSlug) =>
  SHARED_SUBS.map((item) => ({ ...item, parentSlug })),
);

const PLACEHOLDER_IMAGE =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuB2L3I-cDT-SAbb8wlj0WN8JPJXqWgxnBrT6R8CYt3vZVetG4pVDlkvqJ2PNhFiU7E11IELJBlheSge3StWoTNBYefLoyfUgO8yw55_kmCpweSfyKaC5MxJPkKd68Y89J3EZ7Jb0bjDFQceN16v11DAQjLcYRKuddl9fbDmtp3ri5Cu60PdrAFq5T5z0o0vORXYCAhrnoDWYXMqyvdhEcTgtjibPxGYBAbwGzrguaqVBNAWHZhKfAU2j2Ez7tt4lRQDSKEMRKxcAe4";

function getErrorMessage(error) {
  if (error.code === 11000) {
    return "A category with this slug already exists";
  }
  return error.message || "Something went wrong";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MAIN_SLUGS = new Set(["male", "female", "kids"]);

function resolveCategorySlug(item) {
  if (item.slug) return item.slug;
  const byName = { Male: "male", Female: "female", Kids: "kids" };
  return byName[item.name] || slugify(item.name);
}

function resolveCategoryType(item) {
  if (item.type === "main" || item.type === "sub") return item.type;

  const slug = resolveCategorySlug(item);
  if (MAIN_SLUGS.has(slug)) return "main";
  if (
    item.parentSlug ||
    ["male", "female", "kids"].some((mainSlug) => slug.startsWith(`${mainSlug}-`))
  ) {
    return "sub";
  }

  const styleKey = inferStyleKeyFromName(item.name);
  if (styleKey) return "sub";

  return null;
}

function inferStyleKeyFromName(name) {
  const match = DEFAULT_SUBS.find((item) => item.name === name);
  return match?.productStyleKey || "";
}

function resolveParentSlug(item) {
  if (item.parentSlug) return item.parentSlug;

  const slug = resolveCategorySlug(item);
  const fromSlug = ["male", "female", "kids"].find((mainSlug) =>
    slug.startsWith(`${mainSlug}-`),
  );
  if (fromSlug) return fromSlug;

  return null;
}

async function repairLegacyCategories() {
  const broken = await Category.find({
    $or: [
      { type: { $exists: false } },
      { type: null },
      { type: "" },
      { slug: { $exists: false } },
      { slug: null },
      { slug: "" },
    ],
  });

  for (const doc of broken) {
    try {
      if (!doc.slug) {
        const byName = { Male: "male", Female: "female", Kids: "kids" };
        doc.slug = byName[doc.name] || slugify(doc.name);
      }

      if (!doc.type) {
        if (MAIN_SLUGS.has(doc.slug)) {
          doc.type = "main";
          doc.parentSlug = null;
        } else {
          doc.type = "sub";
          if (!doc.parentSlug) {
            doc.parentSlug = resolveParentSlug(doc);
          }
          if (!doc.productStyleKey) {
            doc.productStyleKey = inferStyleKeyFromName(doc.name);
          }
        }
      }

      if (!doc.icon) doc.icon = "category";
      if (!doc.iconVariant) doc.iconVariant = "primary-dim";
      if (doc.type === "sub" && !doc.imageUrl) doc.imageUrl = PLACEHOLDER_IMAGE;

      await doc.save();
    } catch {
      await doc.deleteOne();
    }
  }
}

async function hasCompleteDefaults() {
  const mainSlugs = await Category.distinct("slug", { type: "main" });
  if (!DEFAULT_CATEGORIES.every((item) => mainSlugs.includes(item.slug))) {
    return false;
  }

  const subCounts = await Category.aggregate([
    { $match: { type: "sub", parentSlug: { $in: ["male", "female", "kids"] } } },
    { $group: { _id: "$parentSlug", count: { $sum: 1 } } },
  ]);
  const countByParent = Object.fromEntries(subCounts.map((row) => [row._id, row.count]));
  const subsPerMain = DEFAULT_SUBS.reduce((acc, item) => {
    acc[item.parentSlug] = (acc[item.parentSlug] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(subsPerMain).every(
    ([parentSlug, expectedCount]) => (countByParent[parentSlug] || 0) >= expectedCount,
  );
}

async function dropConflictingIndexes() {
  const indexes = await Category.collection.indexes();
  for (const index of indexes) {
    const keepsSlug = Boolean(index.key?.slug);
    if (index.unique && index.name !== "_id_" && !keepsSlug) {
      try {
        await Category.collection.dropIndex(index.name);
      } catch {
        // Ignore missing/in-use index errors.
      }
    }
  }
}

async function upsertCategory(fields) {
  const existing =
    (await Category.findOne({ slug: fields.slug })) ||
    (fields.type === "sub"
      ? await Category.findOne({
          name: fields.name,
          parentSlug: fields.parentSlug,
          type: "sub",
        })
      : await Category.findOne({ name: fields.name, type: "main" }));

  if (existing) {
    await Category.updateOne({ _id: existing._id }, { $set: fields });
    return;
  }

  try {
    await Category.create(fields);
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

async function syncDefaultCategories() {
  await dropConflictingIndexes();

  for (const item of DEFAULT_CATEGORIES) {
    await upsertCategory({
      name: item.name,
      slug: item.slug,
      type: "main",
      parentSlug: null,
      icon: item.icon,
      iconVariant: item.iconVariant,
      sortOrder: item.sortOrder,
      isActive: true,
    });
  }

  for (const item of DEFAULT_SUBS) {
    await upsertCategory({
      name: item.name,
      slug: `${item.parentSlug}-${slugify(item.name)}`,
      type: "sub",
      parentSlug: item.parentSlug,
      productStyleKey: item.productStyleKey,
      sortOrder: item.sortOrder,
      isActive: true,
      imageUrl: PLACEHOLDER_IMAGE,
    });
  }
}

async function ensureDefaultCategories() {
  try {
    const brokenCount = await Category.countDocuments({
      $or: [
        { type: { $exists: false } },
        { type: null },
        { type: "" },
        { slug: { $exists: false } },
        { slug: null },
        { slug: "" },
      ],
    });

    if (brokenCount > 0) {
      await repairLegacyCategories();
    }

    const complete = await hasCompleteDefaults();
    if (!complete) {
      await syncDefaultCategories();
    }
  } catch (error) {
    console.error("Category seed skipped:", error.message);
  }
}

async function getAllProductStats() {
  const rows = await Product.aggregate([
    {
      $match: {
        verificationStatus: "approved",
        status: { $in: ["active", "sold", "rented"] },
      },
    },
    {
      $group: {
        _id: {
          mainCategory: "$mainCategory",
          style: { $ifNull: ["$style", ""] },
          listingType: "$listingType",
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const mainStats = {};
  const subStats = {};

  for (const row of rows) {
    const mainCategory = row._id.mainCategory;
    const style = row._id.style;
    const listingType = row._id.listingType;
    const mainSlug = Object.entries(MAIN_TO_PRODUCT).find(([, value]) => value === mainCategory)?.[0];

    if (!mainSlug) continue;

    if (!mainStats[mainSlug]) {
      mainStats[mainSlug] = { total: 0, sale: 0, rental: 0 };
    }

    mainStats[mainSlug].total += row.count;
    if (listingType === "sale") mainStats[mainSlug].sale += row.count;
    if (listingType === "rent") mainStats[mainSlug].rental += row.count;

    if (style) {
      const key = `${mainSlug}|${style}`;
      subStats[key] = (subStats[key] || 0) + row.count;
    }
  }

  return { mainStats, subStats };
}

function getStatsForMain(mainStats, mainSlug) {
  return mainStats[mainSlug] || { total: 0, sale: 0, rental: 0 };
}

function getStatsForSub(subStats, mainSlug, styleKey) {
  if (!styleKey) return 0;
  return subStats[`${mainSlug}|${styleKey}`] || 0;
}

async function getProductStats(mainSlug, styleKey) {
  const mainCategory = MAIN_TO_PRODUCT[mainSlug];
  if (!mainCategory) {
    return { total: 0, sale: 0, rental: 0 };
  }

  const baseFilter = {
    mainCategory,
    verificationStatus: "approved",
    status: { $in: ["active", "sold", "rented"] },
  };

  if (styleKey) {
    baseFilter.style = styleKey;
  }

  const [total, sale, rental] = await Promise.all([
    Product.countDocuments(baseFilter),
    Product.countDocuments({ ...baseFilter, listingType: "sale" }),
    Product.countDocuments({ ...baseFilter, listingType: "rent" }),
  ]);

  return { total, sale, rental };
}

function buildQuickStats(mainCategories, subcategoriesByParent) {
  let topSub = { label: "—", count: 0 };
  let totalListings = 0;
  let totalRental = 0;

  for (const main of mainCategories) {
    totalListings += main.totalListings;
    totalRental += main.rentalListings;
    const subs = subcategoriesByParent[main.slug] ?? [];
    for (const sub of subs) {
      if (sub.listings > topSub.count) {
        topSub = { label: `${main.name} ${sub.name}`, count: sub.listings };
      }
    }
  }

  if (topSub.count === 0 && mainCategories.length > 0) {
    const topMain = [...mainCategories].sort(
      (a, b) => b.totalListings - a.totalListings,
    )[0];
    if (topMain.totalListings > 0) {
      topSub = { label: topMain.name, count: topMain.totalListings };
    }
  }

  const rentalRatio =
    totalListings > 0 ? `${Math.round((totalRental / totalListings) * 1000) / 10}%` : "0%";

  return [
    { id: "popular", label: "Most Popular", value: topSub.label, count: topSub.count, icon: "sell" },
    { id: "active", label: "Active Items", value: `${totalListings} Total`, icon: "inventory" },
    { id: "rental-ratio", label: "Rental Ratio", value: rentalRatio, icon: "sync" },
  ];
}

async function listCategories(req, res) {
  try {
    await ensureDefaultCategories();

    const [categories, { mainStats, subStats }] = await Promise.all([
      Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }),
      getAllProductStats(),
    ]);

    const mains = categories.filter((item) => resolveCategoryType(item) === "main");
    const subs = categories.filter((item) => resolveCategoryType(item) === "sub");

    const mainCategories = mains.map((item) => {
      const slug = resolveCategorySlug(item);
      const stats = getStatsForMain(mainStats, slug);
      const salePercent =
        stats.total > 0 ? Math.round((stats.sale / stats.total) * 100) : 0;

      return {
        ...item.toAdminJSON(),
        slug,
        type: "main",
        totalListings: stats.total,
        saleListings: stats.sale,
        rentalListings: stats.rental,
        salePercent,
        rentalPercent: stats.total > 0 ? 100 - salePercent : 0,
      };
    });

    const subcategories = {};
    for (const main of mains) {
      const mainSlug = resolveCategorySlug(main);
      const dbSubs = subs.filter((sub) => resolveParentSlug(sub) === mainSlug);
      const byStyle = new Map(
        dbSubs.map((sub) => [sub.productStyleKey || inferStyleKeyFromName(sub.name), sub]),
      );

      subcategories[mainSlug] = SHARED_SUBS.map((template) => {
        const doc = byStyle.get(template.productStyleKey);
        return {
          id: doc?._id?.toString() || `${mainSlug}-${slugify(template.name)}`,
          slug: doc?.slug || `${mainSlug}-${slugify(template.name)}`,
          name: template.name,
          type: "sub",
          parentSlug: mainSlug,
          productStyleKey: template.productStyleKey,
          sortOrder: template.sortOrder,
          listings: getStatsForSub(subStats, mainSlug, template.productStyleKey),
          image: doc?.imageUrl || PLACEHOLDER_IMAGE,
        };
      });
    }

    res.json({
      mainCategories,
      subcategories,
      quickStats: buildQuickStats(mainCategories, subcategories),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function createCategory(req, res) {
  try {
    const {
      name,
      type,
      parentSlug,
      icon,
      iconVariant,
      imageUrl,
      productStyleKey,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (!["main", "sub"].includes(type)) {
      return res.status(400).json({ message: "Invalid category type" });
    }

    let slug = slugify(req.body.slug || name);
    if (type === "sub") {
      if (!parentSlug) {
        return res.status(400).json({ message: "Parent category is required" });
      }
      const parent = await Category.findOne({ slug: parentSlug, type: "main" });
      if (!parent) {
        return res.status(400).json({ message: "Parent category not found" });
      }
      slug = `${parentSlug}-${slugify(name)}`;
    }

    const exists = await Category.findOne({ slug });
    if (exists) {
      return res.status(400).json({ message: "Category slug already exists" });
    }

    const doc = await Category.create({
      name: name.trim(),
      slug,
      type,
      parentSlug: type === "sub" ? parentSlug : null,
      icon: icon || "category",
      iconVariant: iconVariant || "primary-dim",
      imageUrl: imageUrl?.trim() || PLACEHOLDER_IMAGE,
      productStyleKey: productStyleKey?.trim() || "",
      sortOrder: Number(req.body.sortOrder) || 0,
    });

    res.status(201).json({
      message: "Category created",
      category: doc.toAdminJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function updateCategory(req, res) {
  try {
    const doc = await Category.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (typeof req.body.name === "string" && req.body.name.trim()) {
      doc.name = req.body.name.trim();
    }
    if (typeof req.body.icon === "string") doc.icon = req.body.icon.trim();
    if (typeof req.body.iconVariant === "string") doc.iconVariant = req.body.iconVariant;
    if (typeof req.body.imageUrl === "string") doc.imageUrl = req.body.imageUrl.trim();
    if (typeof req.body.productStyleKey === "string") {
      doc.productStyleKey = req.body.productStyleKey.trim();
    }
    if (typeof req.body.sortOrder === "number") doc.sortOrder = req.body.sortOrder;

    await doc.save();

    res.json({
      message: "Category updated",
      category: doc.toAdminJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function deleteCategory(req, res) {
  try {
    const doc = await Category.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (doc.type === "main") {
      const childCount = await Category.countDocuments({ parentSlug: doc.slug, type: "sub" });
      if (childCount > 0) {
        return res.status(400).json({ message: "Remove subcategories first" });
      }
      const stats = await getProductStats(doc.slug);
      if (stats.total > 0) {
        return res.status(400).json({ message: "Cannot delete: products use this category" });
      }
    } else {
      const stats = await getProductStats(doc.parentSlug, doc.productStyleKey);
      if (stats.total > 0) {
        return res.status(400).json({ message: "Cannot delete: products use this subcategory" });
      }
    }

    await doc.deleteOne();
    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
