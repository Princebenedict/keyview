// KeyView access contract.
//
// A viewing key is an on-chain grant: (trader, holder) -> expiry. Holding a
// grant gives read access to that trader's private strategy off-chain. It is
// not a wallet key and cannot move funds. Buying again extends an active
// grant. The trader can revoke a holder at any time.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const DAY_MS: u64 = 86_400_000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Grant {
    pub expires_at_ms: u64,
    pub revoked: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    // (trader, duration_days) -> price in yoctoNEAR
    offers: LookupMap<(AccountId, u64), u128>,
    // (trader, holder) -> grant
    grants: LookupMap<(AccountId, AccountId), Grant>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self { offers: LookupMap::new(b"o"), grants: LookupMap::new(b"g") }
    }

    /// Trader sets the price for a 7 or 30 day key. Price 0 removes the offer.
    pub fn set_offer(&mut self, duration_days: u64, price_yocto: U128) {
        require!(duration_days == 7 || duration_days == 30, "duration must be 7 or 30");
        let trader = env::predecessor_account_id();
        if price_yocto.0 == 0 {
            self.offers.remove(&(trader, duration_days));
        } else {
            self.offers.insert((trader, duration_days), price_yocto.0);
        }
    }

    /// Buyer pays the trader and receives (or extends) a grant. Excess deposit is refunded.
    #[payable]
    pub fn buy_key(&mut self, trader: AccountId, duration_days: u64) -> Grant {
        let price = *self
            .offers
            .get(&(trader.clone(), duration_days))
            .unwrap_or_else(|| env::panic_str("no such offer"));
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= price, "attached deposit is below the price");
        let buyer = env::predecessor_account_id();
        require!(buyer != trader, "traders do not need to buy their own key");

        let now = env::block_timestamp_ms();
        let start = match self.grants.get(&(trader.clone(), buyer.clone())) {
            Some(g) if !g.revoked && g.expires_at_ms > now => g.expires_at_ms,
            _ => now,
        };
        let grant = Grant { expires_at_ms: start + duration_days * DAY_MS, revoked: false };
        self.grants.insert((trader.clone(), buyer.clone()), grant.clone());

        let _ = Promise::new(trader).transfer(NearToken::from_yoctonear(price));
        if paid > price {
            let _ = Promise::new(buyer).transfer(NearToken::from_yoctonear(paid - price));
        }
        grant
    }

    /// Trader ends a holder's access early.
    pub fn revoke(&mut self, holder: AccountId) {
        let trader = env::predecessor_account_id();
        let mut g = self
            .grants
            .get(&(trader.clone(), holder.clone()))
            .cloned()
            .unwrap_or_else(|| env::panic_str("no grant for that holder"));
        g.revoked = true;
        self.grants.insert((trader, holder), g);
    }

    pub fn get_offer(&self, trader: AccountId, duration_days: u64) -> Option<U128> {
        self.offers.get(&(trader, duration_days)).map(|p| U128(*p))
    }

    pub fn get_grant(&self, trader: AccountId, holder: AccountId) -> Option<Grant> {
        self.grants.get(&(trader, holder)).cloned()
    }

    /// The off-chain server calls this view to decide whether to unlock.
    pub fn has_access(&self, trader: AccountId, holder: AccountId) -> bool {
        match self.grants.get(&(trader, holder)) {
            Some(g) => !g.revoked && g.expires_at_ms > env::block_timestamp_ms(),
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(predecessor: AccountId, deposit: u128, ts_ms: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(predecessor)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts_ms * 1_000_000)
            .build());
    }

    fn setup() -> Contract {
        ctx(accounts(0), 0, 1_000);
        let mut c = Contract::new();
        c.set_offer(7, U128(100));
        c
    }

    #[test]
    fn buy_grants_access_until_expiry() {
        let mut c = setup();
        ctx(accounts(1), 100, 1_000);
        let g = c.buy_key(accounts(0), 7);
        assert_eq!(g.expires_at_ms, 1_000 + 7 * DAY_MS);
        ctx(accounts(2), 0, 1_000 + 7 * DAY_MS - 1);
        assert!(c.has_access(accounts(0), accounts(1)));
        ctx(accounts(2), 0, 1_000 + 7 * DAY_MS);
        assert!(!c.has_access(accounts(0), accounts(1)));
    }

    #[test]
    fn buying_again_extends_active_grant() {
        let mut c = setup();
        ctx(accounts(1), 100, 1_000);
        c.buy_key(accounts(0), 7);
        ctx(accounts(1), 100, 2_000);
        let g = c.buy_key(accounts(0), 7);
        assert_eq!(g.expires_at_ms, 1_000 + 14 * DAY_MS);
    }

    #[test]
    fn trader_can_revoke() {
        let mut c = setup();
        ctx(accounts(1), 100, 1_000);
        c.buy_key(accounts(0), 7);
        ctx(accounts(0), 0, 2_000);
        c.revoke(accounts(1));
        assert!(!c.has_access(accounts(0), accounts(1)));
    }

    #[test]
    #[should_panic(expected = "attached deposit is below the price")]
    fn underpaying_fails() {
        let mut c = setup();
        ctx(accounts(1), 99, 1_000);
        c.buy_key(accounts(0), 7);
    }

    #[test]
    #[should_panic(expected = "no such offer")]
    fn missing_offer_fails() {
        let mut c = setup();
        ctx(accounts(1), 100, 1_000);
        c.buy_key(accounts(0), 30);
    }

    #[test]
    fn grant_is_per_trader() {
        let mut c = setup();
        ctx(accounts(1), 100, 1_000);
        c.buy_key(accounts(0), 7);
        assert!(!c.has_access(accounts(3), accounts(1)));
        assert!(!c.has_access(accounts(0), accounts(2)));
    }
}
