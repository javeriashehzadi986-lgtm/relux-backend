function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

function mockReq(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    user: null,
    ...overrides,
  };
}

function mockOrderFindOne(OrderModel, { pendingOrder = null, paidOrder = null } = {}) {
  OrderModel.findOne = jest.fn().mockImplementation((query) => {
    if (query?.paymentStatus === "paid") {
      return Promise.resolve(paidOrder);
    }
    return { sort: jest.fn().mockResolvedValue(pendingOrder) };
  });
}

function makeSortResult(value, leanValue = value) {
  return {
    lean: jest.fn().mockResolvedValue(leanValue),
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function mockBidQueries(BidModel, UserModel, { highestBid = null, userHighest = null, history = [] } = {}) {
  BidModel.findOne = jest.fn().mockImplementation(() => ({
    sort: jest.fn().mockImplementation(() => makeSortResult(highestBid, userHighest)),
  }));
  BidModel.distinct = jest.fn().mockResolvedValue([]);
  BidModel.find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(history),
      }),
    }),
  });
  UserModel.find = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    }),
  });
}

module.exports = { mockRes, mockReq, mockOrderFindOne, mockBidQueries };
