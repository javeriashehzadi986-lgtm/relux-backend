function getProductAvailability(product) {
  if (!product) {
    return {
      key: "unavailable",
      label: "Unavailable",
      canPurchase: false,
    };
  }

  if (product.status === "sold") {
    return { key: "sold", label: "Sold", canPurchase: false };
  }
  if (product.status === "rented") {
    return { key: "rented", label: "Currently Rented", canPurchase: false };
  }
  if (product.status === "removed") {
    return { key: "removed", label: "Removed", canPurchase: false };
  }
  if (product.verificationStatus === "pending" || product.status === "pending") {
    return { key: "pending", label: "Pending Review", canPurchase: false };
  }
  if (product.verificationStatus === "rejected") {
    return { key: "rejected", label: "Not Approved", canPurchase: false };
  }
  if (product.isAvailable === false) {
    return { key: "unavailable", label: "Unavailable", canPurchase: false };
  }
  if (product.status === "active" && product.verificationStatus === "approved") {
    return { key: "available", label: "Available", canPurchase: true };
  }

  return { key: "unavailable", label: "Unavailable", canPurchase: false };
}

function isListedPublicly(product) {
  const info = getProductAvailability(product);
  return info.key === "available";
}

module.exports = {
  getProductAvailability,
  isListedPublicly,
};
