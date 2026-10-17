//! "Pair backs with AI": the model looks at a small picture of every piece of the library and says which are fronts,
//! which are backs, and which back goes with each front. For files whose backs are not where a rule can find them:
//! a back per deck, or backs in another order. The answer is checked to cover every piece once, and a front's back
//! must be a piece the answer itself calls a back.

use crate::error::{AiError, Result};
use crate::provider::{AiRequest, Image};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Most pieces in one run: one picture each, in one request, since a front and its back must be seen together.
/// Some providers take no more than 100 pictures in a request.
pub const MAX_PIECES: usize = 100;
/// Long side of each piece's picture, in pixels.
pub const PIECE_LONG_SIDE_PX: u32 = 256;
const OUTPUT_TOKENS_PER_PIECE: u32 = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Front,
    Back,
    /// Neither: a rules card, a blank, a piece with no other side.
    Other,
}

impl Side {
    const ALL: [Side; 3] = [Side::Front, Side::Back, Side::Other];

    fn name(self) -> &'static str {
        match self {
            Side::Front => "front",
            Side::Back => "back",
            Side::Other => "other",
        }
    }
}

/// What the answer says about one piece. Indexes are 0-based, in the order the pieces were sent.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PieceSide {
    pub index: usize,
    pub side: Side,
    /// For a front: the piece that is its back, if the answer found one.
    pub back: Option<usize>,
    /// For a back: its art is upside down, so it needs a half turn to face like its fronts.
    pub upside_down: bool,
}

pub fn pair_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "pieces": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "piece": { "type": "integer" },
                        "side": { "type": "string", "enum": Side::ALL.map(Side::name) },
                        "back": { "type": "integer" },
                        "upside_down": { "type": "boolean" },
                    },
                    "required": ["piece", "side", "back", "upside_down"],
                },
            },
        },
        "required": ["pieces"],
    })
}

const RULES: &str = "Each picture is one piece cut out of a print-and-play game: a card, token or tile. Some are \
fronts, the side that differs from piece to piece, and some are backs, the side a whole deck or a set of pieces \
shares, or a piece's own other side. Answer once for every picture, by its number: side \"front\", \"back\" or \
\"other\" (neither, such as a rules card). For a front, give in back the number of the picture that is its back: the \
back of its deck (same frame, colours or deck name), or its own back when every piece has a different one (where \
the pieces sit in the file can help, as fronts and backs are often on matching places of matching pages). Give 0 \
when none of the pictures is its back. When several pictures show the same back, any of them will do. Give back 0 \
for backs and others. Set upside_down to true for a back whose art or text is upside down, and false otherwise and \
for fronts and others.";

/// The request for `pieces`: a short name for each (where it is in the file) and its picture.
pub fn pair_request(pieces: Vec<(String, Image)>) -> Result<AiRequest> {
    if pieces.len() > MAX_PIECES {
        return Err(AiError::TooManyPieces {
            count: pieces.len(),
            max: MAX_PIECES,
        });
    }
    let names: Vec<String> = pieces
        .iter()
        .enumerate()
        .map(|(i, (name, _))| format!("Picture {}: {}", i + 1, name))
        .collect();
    let instruction = format!(
        "The pictures are {} pieces of a print-and-play game, in this order, each named by where it is in the file \
         (page, grid, row and column, after the PDF's letter when there are several):\n{}\n{RULES}",
        pieces.len(),
        names.join("\n")
    );
    let count = pieces.len() as u32;
    Ok(AiRequest {
        instruction,
        images: pieces.into_iter().map(|(_, image)| image).collect(),
        schema: pair_schema(),
        max_output_tokens: 256 + OUTPUT_TOKENS_PER_PIECE * count,
    })
}

fn number(item: &Value, name: &str) -> Result<u64> {
    item.get(name)
        .and_then(Value::as_u64)
        .ok_or_else(|| AiError::InvalidReply(format!("`{name}` is missing or not a whole number")))
}

/// The sides in a reply about `count` pieces: every piece once, and every front's back a piece called a back.
pub fn parse_pairing(reply: &Value, count: usize) -> Result<Vec<PieceSide>> {
    let list = reply
        .get("pieces")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::InvalidReply("`pieces` is missing".into()))?;
    let mut seen: HashSet<usize> = HashSet::new();
    let mut sides: Vec<PieceSide> = Vec::with_capacity(list.len());
    let mut backs_of: Vec<(usize, u64)> = Vec::new();
    for item in list {
        let n = number(item, "piece")?;
        if n == 0 || n > count as u64 {
            return Err(AiError::InvalidProposal(format!(
                "piece {n} was not one of the {count} pieces sent"
            )));
        }
        let index = (n - 1) as usize;
        if !seen.insert(index) {
            return Err(AiError::InvalidProposal(format!(
                "piece {n} is answered twice"
            )));
        }
        let side: Side =
            serde_json::from_value(item.get("side").cloned().unwrap_or(Value::Null))
                .map_err(|_| AiError::InvalidReply(format!("piece {n} has an unknown side")))?;
        let back = number(item, "back")?;
        let upside_down = item
            .get("upside_down")
            .and_then(Value::as_bool)
            .ok_or_else(|| AiError::InvalidReply(format!("piece {n} has no upside_down")))?;
        if side == Side::Front && back != 0 {
            backs_of.push((index, back));
        }
        sides.push(PieceSide {
            index,
            side,
            back: None,
            upside_down: side == Side::Back && upside_down,
        });
    }
    if let Some(missing) = (0..count).find(|i| !seen.contains(i)) {
        return Err(AiError::InvalidProposal(format!(
            "piece {} has no answer",
            missing + 1
        )));
    }
    sides.sort_by_key(|s| s.index);
    for (front, back) in backs_of {
        let is_back =
            back <= count as u64 && back >= 1 && sides[(back - 1) as usize].side == Side::Back;
        if !is_back {
            return Err(AiError::InvalidProposal(format!(
                "the back of piece {} is piece {back}, which is not a back",
                front + 1
            )));
        }
        sides[front].back = Some((back - 1) as usize);
    }
    Ok(sides)
}
