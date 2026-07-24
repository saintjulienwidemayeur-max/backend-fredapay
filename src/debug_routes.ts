// Fichye debug - kouri sa pou jwenn ki route ki kaze
import "dotenv/config";

const testRoute = (name: string, fn: () => any) => {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e: any) {
    console.error(`❌ ${name} -> ${e.message}`);
  }
};

testRoute("webhooks",      () => require("./routes/webhooks"));
testRoute("cards",         () => require("./routes/cards"));
testRoute("admin",         () => require("./routes/admin"));
testRoute("kyc",           () => require("./routes/kyc"));
testRoute("auth",          () => require("./routes/auth"));
testRoute("auth2fa",       () => require("./routes/auth2fa"));
testRoute("wallet",        () => require("./routes/wallet"));
testRoute("notifications", () => require("./routes/notifications"));
testRoute("users",         () => require("./routes/users"));
testRoute("maplerad", () => require("./routes/maplerad"));;
testRoute("fredai",        () => require("./routes/fredai"));
