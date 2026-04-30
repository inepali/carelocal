'use client'

import { useState } from 'react'
import { Star, Loader2, X, AlertTriangle } from 'lucide-react'

interface ReviewModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: any) => Promise<void>
  reviewerType: 'staff' | 'center'
  title: string
}

export function ReviewModal({ isOpen, onClose, onSubmit, reviewerType, title }: ReviewModalProps) {
  const [rating, setRating] = useState<number>(0)
  const [hoveredRating, setHoveredRating] = useState<number>(0)
  const [tags, setTags] = useState<string[]>([])
  const [publicComment, setPublicComment] = useState('')
  const [privateFeedback, setPrivateFeedback] = useState('')
  const [punctual, setPunctual] = useState(true)
  const [doNotReturn, setDoNotReturn] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const staffTags = ['Great environment', 'Clear instructions', 'Welcoming team', 'Chaotic', 'Unsafe ratios']
  const centerTags = ['Great with kids', 'Followed instructions', 'Professional', 'Needs supervision', 'Inappropriate attire']
  const availableTags = reviewerType === 'staff' ? staffTags : centerTags

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0) {
      alert('Please provide a star rating.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        rating,
        tags,
        public_comment: publicComment,
        private_feedback: privateFeedback,
        ...(reviewerType === 'center' ? { punctual, do_not_return: doNotReturn } : {})
      })
      onClose()
      // reset state
      setRating(0)
      setTags([])
      setPublicComment('')
      setPrivateFeedback('')
      setPunctual(true)
      setDoNotReturn(false)
    } catch (error) {
      alert('Failed to submit review.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-[#e6ece9] flex justify-between items-center bg-[#f8faf9]">
          <h2 className="text-xl font-bold text-[#0b3828]">{title}</h2>
          <button 
            onClick={onClose}
            className="text-[#6b7a73] hover:text-[#1a2e25] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#e6ece9] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <form id="review-form" onSubmit={handleSubmit} className="space-y-6">
            
            {/* Star Rating */}
            <div className="flex flex-col items-center">
              <label className="block text-sm font-bold text-[#1a2e25] mb-2">Overall Rating</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className="p-1 transition-transform hover:scale-110"
                  >
                    <Star 
                      className={`w-10 h-10 ${
                        (hoveredRating || rating) >= star 
                          ? 'fill-[#fbbf24] text-[#fbbf24]' 
                          : 'fill-transparent text-[#e2e8e4]'
                      }`} 
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-bold text-[#1a2e25] mb-2">Select all that apply</label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border transition-colors ${
                      tags.includes(tag)
                        ? 'bg-[#157354] text-white border-[#157354]'
                        : 'bg-[#f8faf9] text-[#6b7a73] border-[#e2e8e4] hover:border-[#157354]/30'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Center-specific questions */}
            {reviewerType === 'center' && (
              <div className="space-y-4 pt-4 border-t border-[#e2e8e4]">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="punctual"
                    checked={punctual}
                    onChange={(e) => setPunctual(e.target.checked)}
                    className="w-5 h-5 border border-[#e2e8e4] rounded bg-white focus:ring-3 focus:ring-[#157354]/30 accent-[#157354]"
                  />
                  <label htmlFor="punctual" className="text-sm font-bold text-[#1a2e25]">
                    Staff member arrived on time
                  </label>
                </div>
                <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-100">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <input
                        type="checkbox"
                        id="doNotReturn"
                        checked={doNotReturn}
                        onChange={(e) => setDoNotReturn(e.target.checked)}
                        className="w-4 h-4 border border-red-200 rounded focus:ring-3 focus:ring-red-200 accent-red-600"
                      />
                      <label htmlFor="doNotReturn" className="text-sm font-bold text-red-900">
                        Do not send back
                      </label>
                    </div>
                    <p className="text-xs text-red-700 ml-7">
                      Checking this will permanently block this staff member from claiming future shifts at your center.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Comments */}
            <div>
              <label className="block text-sm font-bold text-[#1a2e25] mb-2">Public Comment (Optional)</label>
              <textarea
                value={publicComment}
                onChange={(e) => setPublicComment(e.target.value)}
                placeholder="Share your experience (visible to others)..."
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-white focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] min-h-[80px]"
              />
            </div>
            
            <div>
              <label className="block text-sm font-bold text-[#1a2e25] mb-2">Private Feedback (Optional)</label>
              <textarea
                value={privateFeedback}
                onChange={(e) => setPrivateFeedback(e.target.value)}
                placeholder="Only visible to Carelocal admins..."
                className="w-full px-4 py-3 rounded-xl border border-[#e2e8e4] bg-[#f8faf9] focus:outline-none focus:ring-2 focus:ring-[#157354]/30 focus:border-[#157354] transition text-[#1a2e25] min-h-[80px]"
              />
            </div>

          </form>
        </div>

        <div className="p-4 border-t border-[#e6ece9] bg-[#f8faf9] flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 border border-[#e2e8e4] text-[#6b7a73] font-bold rounded-xl hover:bg-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="review-form"
            disabled={submitting || rating === 0}
            className="px-6 py-2.5 bg-[#157354] text-white font-bold rounded-xl hover:bg-[#0f4a36] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Review'}
          </button>
        </div>
      </div>
    </div>
  )
}
