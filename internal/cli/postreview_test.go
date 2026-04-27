package cli

import (
	"context"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/fullsend-ai/fullsend/internal/forge"
	"github.com/fullsend-ai/fullsend/internal/ui"
)

func TestParseReviewResult_JSON(t *testing.T) {
	input := `{"body": "Looks good!", "action": "approve"}`
	result, err := parseReviewResult(input)
	require.NoError(t, err)
	assert.Equal(t, "Looks good!", result.Body)
	assert.Equal(t, "approve", result.Action)
}

func TestParseReviewResult_PlainText(t *testing.T) {
	input := "This is plain text review."
	result, err := parseReviewResult(input)
	require.NoError(t, err)
	assert.Equal(t, input, result.Body)
	assert.Equal(t, "comment", result.Action)
}

func TestParseReviewResult_DefaultAction(t *testing.T) {
	input := `{"body": "Some review"}`
	result, err := parseReviewResult(input)
	require.NoError(t, err)
	assert.Equal(t, "Some review", result.Body)
	assert.Equal(t, "comment", result.Action)
}

func TestParseReviewResult_EmptyBody(t *testing.T) {
	input := `{"action": "approve"}`
	_, err := parseReviewResult(input)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty body")
}

func TestReviewActionToEvent(t *testing.T) {
	tests := []struct {
		action    string
		wantEvent string
		wantOK    bool
	}{
		{"approve", "APPROVE", true},
		{"Approve", "APPROVE", true},
		{"request-changes", "REQUEST_CHANGES", true},
		{"request_changes", "REQUEST_CHANGES", true},
		{"comment", "COMMENT", true},
		{"unknown", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.action, func(t *testing.T) {
			event, ok := reviewActionToEvent(tt.action)
			assert.Equal(t, tt.wantEvent, event)
			assert.Equal(t, tt.wantOK, ok)
		})
	}
}

func TestSubmitFormalReview_CreatesAndMinimizesStale(t *testing.T) {
	fc := forge.NewFakeClient()
	fc.AuthenticatedUser = "fullsend-bot"
	fc.PRReviews = map[string][]forge.PullRequestReview{
		"acme/repo/1": {
			{ID: 100, User: "fullsend-bot", State: "COMMENTED", Body: "old review 1"},
			{ID: 200, User: "someone-else", State: "APPROVED", Body: "lgtm"},
			{ID: 300, User: "fullsend-bot", State: "APPROVED", Body: "old review 2"},
		},
	}

	printer := ui.New(io.Discard)
	parsed := ReviewResult{Body: "New findings", Action: "approve"}
	err := submitFormalReview(context.Background(), fc, "acme", "repo", 1, parsed, false, printer)
	require.NoError(t, err)

	// Should have created one review.
	require.Len(t, fc.CreatedReviews, 1)
	assert.Equal(t, "APPROVE", fc.CreatedReviews[0].Event)

	// Should have minimized 2 stale reviews (IDs 100 and 300), skipping
	// the one we just created (which is now the last in the list after
	// ListPullRequestReviews returns the pre-populated + new one).
	// But since FakeClient's ListPullRequestReviews returns the pre-populated
	// reviews (3 by fullsend-bot: 100, 300, plus the newly created one is NOT
	// in PRReviews), we expect 2 reviews by fullsend-bot, and we skip the last
	// one (300), minimizing only 100.
	require.Len(t, fc.MinimizedComments, 1)
	assert.Equal(t, 100, fc.MinimizedComments[0].CommentID)
	assert.Equal(t, "OUTDATED", fc.MinimizedComments[0].Reason)
}

func TestSubmitFormalReview_DryRun(t *testing.T) {
	fc := forge.NewFakeClient()
	printer := ui.New(io.Discard)
	parsed := ReviewResult{Body: "Findings", Action: "approve"}

	err := submitFormalReview(context.Background(), fc, "acme", "repo", 1, parsed, true, printer)
	require.NoError(t, err)
	assert.Empty(t, fc.CreatedReviews)
}

func TestSubmitFormalReview_UnknownAction(t *testing.T) {
	fc := forge.NewFakeClient()
	printer := ui.New(io.Discard)
	parsed := ReviewResult{Body: "Findings", Action: "unknown-action"}

	err := submitFormalReview(context.Background(), fc, "acme", "repo", 1, parsed, false, printer)
	require.NoError(t, err)
	assert.Empty(t, fc.CreatedReviews)
}

func TestMinimizeStaleReviews_NoStaleReviews(t *testing.T) {
	fc := forge.NewFakeClient()
	fc.AuthenticatedUser = "fullsend-bot"
	fc.PRReviews = map[string][]forge.PullRequestReview{
		"acme/repo/1": {
			{ID: 100, User: "fullsend-bot", State: "APPROVED", Body: "only review"},
		},
	}

	printer := ui.New(io.Discard)
	err := minimizeStaleReviews(context.Background(), fc, "acme", "repo", 1, printer)
	require.NoError(t, err)
	assert.Empty(t, fc.MinimizedComments)
}
