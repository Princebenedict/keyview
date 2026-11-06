// KeyView access contract (NEP-171 style viewing keys).
//
// One token = one time-limited viewing key for one trader. The token owner
// is the buyer. Holding the token grants read access off-chain only; it never
// controls any wallet. NOTE: not compiled or deployed in the authoring
// sandbox. Build with `cargo near build` and run the tests before deploying.
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

#[derive(Serialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ViewingKey {
    pub token_id: String,
    pub trader: AccountId,
    pub owner: AccountId,
    pub expires_at_ms: u64,
    pub revoked: bool,
}

#[near(serializers = [borsh])]
struct KeyRecord {
    trader: AccountId,
    owner: AccountId,
    expires_at_ms: u64,
    revoked: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    next_id: u64,
    keys: UnorderedMap<String, KeyRecord>,
    // trader -> (duration_days -> price in yoctoNEAR)
    offers: LookupMap<(AccountId, u64), u128>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            next_id: 0,
            keys: UnorderedMap::new(b"k"),
            offers: LookupMap::new(b"o"),
        }
    }

    /// Trader sets the price for a duration. Price 0 removes the offer.
    pub fn set_offer(&mut self, duration_days: u64, price_yocto: U128) {
        require!(duration_days == 7 || duration_days == 30, "duration must be 7 or 30");
        let trader = env::predecessor_account_id();
        if price_yocto.0 == 0 {
            self.offers.remove(&(trader, duration_days));
        } else {
            self.offers.insert(&(trader, duration_days), &price_yocto.0);
        }
    }

    /// Buyer pays the trader and receives a viewing key.
    #[payable]
    pub fn buy_key(&mut self, trader: AccountId, duration_days: u64) -> String {
        let price = self
            .offers
            .get(&(trader.clone(), duration_days))
            .unwrap_or_else(|| env::panic_str("no such offer"));
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= price, "attached deposit is below the price");
        let buyer = env::predecessor_account_id();
        let token_id = format!("kv-{}", self.next_id);
        self.next_id += 1;
        let expires = env::block_timestamp_ms() + duration_days * 86_400_000;
        self.keys.insert(
            &token_id,
            &KeyRecord { trader: trader.clone(), owner: buyer.clone(), expires_at_ms: expires, revoked: false },
        );
        Promise::new(trader).transfer(NearToken::from_yoctonear(price));
        let refund = paid - price;
        if refund > 0 {
            Promise::new(buyer).transfer(NearToken::from_yoctonear(refund));
        }
        token_id
    }

    /// Trader can end a key early.
    pub fn revoke(&mut self, token_id: String) {
        let mut rec = self.keys.get(&token_id).unwrap_or_else(|| env::panic_str("unknown key"));
        require!(env::predecessor_account_id() == rec.trader, "only the trader can revoke");
        rec.revoked = true;
        self.keys.insert(&token_id, &rec);
    }

    /// The off-chain server calls this view to decide whether to unlock.
    pub fn has_access(&self, trader: AccountId, holder: AccountId) -> bool {
        let now = env::block_timestamp_ms();
        self.keys.iter().any(|(_, r)| r.trader == trader && r.owner == holder && !r.revoked && r.expires_at_ms > now)
    }

    // NEP-171 read methods (minimal subset).
    pub fn nft_token(&self, token_id: String) -> Option<ViewingKey> {
        self.keys.get(&token_id).map(|r| ViewingKey {
            token_id, trader: r.trader, owner: r.owner, expires_at_ms: r.expires_at_ms, revoked: r.revoked,
        })
    }
}
