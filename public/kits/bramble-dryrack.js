take('item.flower', 2);
give('item.dried-flower', 1);
state.bundles = (state.bundles || 0) + 1;
say('You bind two flowers and hang them in the warm air. One dry bundle is ready from the last turning.');
