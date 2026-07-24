# CHANGELOG Backend v67 — Fix doub notifikasyon + optimizasyon history

## 🔴 FIX #1: DOUB NOTIFIKASYON (BUG KONFIME)

**Pwoblèm**: Lè yon moun voye lajan P2P, DE kote te voye notifikasyon:
1. `WalletService.sendMoney()` → `NotificationService.send("transaction_received")` + `send("transaction_sent")`
2. Wout `/send` → `NotificationService.transactionReceived()` + `transactionSent()`

Rezilta: CHAK moun resevwa **2 notifikasyon + 2 push** pou MENM tranzaksyon an.

**Koreksyon**: Retire apèl notifikasyon doublon nan wout `/send` —
`WalletService.sendMoney()` DEJA jere notifikasyon yo (in-app + push +
checkLowBalance). Wout la kenbe sèlman email confirmation (ki PA nan sèvis la).

**Fichye**: `src/routes/wallet.ts`

## ⚡ FIX #2: `/history` te chaje 500 tranzaksyon CHAK FWA

**Pwoblèm**: Endpoint `/history` te rele `WalletService.getHistory(userId, 500)`
ki chaje 500 tranzaksyon + avatar lookup pou chak P2P, menm si kliyan an
bezwen sèlman 20. Sa te fè endpoint la lant (3-5s sou Render free tier).

**Koreksyon**: Chaje sèlman `limit * page + 10` tranzaksyon (jis sa kliyan an
bezwen + yon ti maj). Paj 1 ak 20 rezilta: ~30 row olye 500.

**Fichye**: `src/routes/wallet.ts`
